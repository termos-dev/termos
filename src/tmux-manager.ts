import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { Layout, SimpleLayout, GroupedLayout, LAYOUT_TO_TMUX, isGroupedLayout, getGroupEntries } from "./config.js";

const execFileAsync = promisify(execFile);

// Position info for a process in a grouped layout
export interface GroupPosition {
  groupName: string;
  posInGroup: number;
}

export type TerminalApp = "auto" | "tmux" | "ghostty" | "iterm" | "kitty" | "terminal";

/**
 * Check if we're running inside a tmux session
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Detect the user's terminal application from environment
 * Note: Warp doesn't support running commands, so we skip it and use Terminal.app
 */
export function detectTerminal(): Exclude<TerminalApp, "auto" | "tmux" | "warp"> {
  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram === "ghostty") return "ghostty";
  if (termProgram === "iTerm.app") return "iterm";
  if (termProgram === "kitty") return "kitty";
  // Warp doesn't support running commands, fall back to Terminal.app
  return "terminal";
}

export interface PaneInfo {
  paneId: string;
  panePid: number;
  isDead: boolean;
  exitStatus?: number;
}

export interface TmuxManagerOptions {
  sessionPrefix?: string;
  layout?: Layout;
}

/**
 * Check if tmux is available on the system
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("which", ["tmux"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all active sidecar tmux sessions
 */
export async function listSidecarSessions(prefix = "sidecar"): Promise<Array<{ name: string; windows: number; created: Date }>> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}:#{session_windows}:#{session_created}",
    ]);

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => {
        const [name, windows, created] = line.split(":");
        return {
          name,
          windows: parseInt(windows, 10),
          created: new Date(parseInt(created, 10) * 1000),
        };
      });
  } catch {
    // No sessions or tmux not running
    return [];
  }
}

/**
 * Manages a tmux session for process orchestration
 */
export class TmuxManager {
  readonly sessionName: string;
  private layout: Layout;
  private paneMap = new Map<string, string>(); // processName -> paneId
  // For grouped layouts: track first pane of each group for splitting (keyed by group name)
  private groupFirstPanes = new Map<string, string>();
  // Track group order for determining "previous group"
  private groupOrder: string[] = [];

  constructor(projectName: string, options: TmuxManagerOptions = {}) {
    const prefix = options.sessionPrefix ?? "sidecar";
    this.sessionName = `${prefix}-${this.sanitizeName(projectName)}`;
    this.layout = options.layout ?? "grid";

    // Initialize group order from layout
    if (isGroupedLayout(this.layout)) {
      this.groupOrder = Object.keys(this.layout.groups);
    }
  }

  /**
   * Get the group name and position for a process in grouped layout
   * Returns { groupName, posInGroup } or null if not found
   */
  private getGroupPosition(processName: string): GroupPosition | null {
    if (!isGroupedLayout(this.layout)) return null;

    for (const [groupName, processes] of Object.entries(this.layout.groups)) {
      const posIdx = processes.indexOf(processName);
      if (posIdx !== -1) {
        return { groupName, posInGroup: posIdx };
      }
    }
    return null;
  }

  /**
   * Get the previous group name in order
   */
  private getPreviousGroupName(groupName: string): string | null {
    const idx = this.groupOrder.indexOf(groupName);
    if (idx <= 0) return null;
    return this.groupOrder[idx - 1];
  }

  /**
   * Get available group names
   */
  getGroupNames(): string[] {
    if (!isGroupedLayout(this.layout)) return [];
    return [...this.groupOrder];
  }

  /**
   * Add a dynamic group (for dynamic terminals when no grouped layout)
   */
  addDynamicGroup(groupName: string): void {
    if (!this.groupOrder.includes(groupName)) {
      this.groupOrder.push(groupName);
    }
  }

  /**
   * Sanitize project name for use in tmux session name
   */
  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  }

  /**
   * Check if the session already exists
   */
  async sessionExists(): Promise<boolean> {
    try {
      await execFileAsync("tmux", ["has-session", "-t", this.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new tmux session (detached)
   * Returns the final session name (may have suffix if collision)
   */
  async createSession(): Promise<string> {
    // Check if our exact session already exists and is recent (within 30 seconds)
    // This handles the case where Claude Code might start the MCP server twice
    try {
      const { stdout } = await execFileAsync("tmux", [
        "display-message", "-t", this.sessionName, "-p", "#{session_created}"
      ]);
      const createdTime = parseInt(stdout.trim(), 10) * 1000;
      const ageMs = Date.now() - createdTime;
      if (ageMs < 30000) {
        // Session exists and is recent, reuse it
        console.error(`[sidecar] Reusing existing session: ${this.sessionName} (created ${Math.round(ageMs / 1000)}s ago)`);
        return this.sessionName;
      }
    } catch {
      // Session doesn't exist, continue with creation
    }

    // Check for collision and find unique name
    let finalName = this.sessionName;
    let suffix = 0;

    while (true) {
      try {
        await execFileAsync("tmux", ["has-session", "-t", finalName]);
        // Session exists, try next suffix
        suffix++;
        finalName = `${this.sessionName}-${suffix}`;
      } catch {
        // Session doesn't exist, we can use this name
        break;
      }
    }

    // Create the session with a placeholder window (we'll replace it)
    await execFileAsync("tmux", [
      "new-session",
      "-d",
      "-s",
      finalName,
      "-n",
      "sidecar",
      // Keep pane alive after command exits to capture exit status
      "-x", "200", // Set initial width
      "-y", "50",  // Set initial height
    ]);

    // Configure session options
    await this.runTmux(["set-option", "-t", finalName, "remain-on-exit", "on"]);
    await this.runTmux(["set-option", "-t", finalName, "history-limit", "50000"]);

    // Update session name if we had to use suffix
    if (finalName !== this.sessionName) {
      (this as { sessionName: string }).sessionName = finalName;
    }

    return finalName;
  }

  /**
   * Destroy the tmux session and all panes
   */
  async destroySession(): Promise<void> {
    try {
      await execFileAsync("tmux", ["kill-session", "-t", this.sessionName]);
    } catch {
      // Session may already be gone
    }
    this.paneMap.clear();
  }

  /**
   * Create a new pane for a process
   * Returns the pane ID
   */
  async createPane(processName: string, command: string, cwd: string, env?: Record<string, string>): Promise<string> {
    // Build environment exports for only custom/process-specific vars
    let envExports = "";
    if (env) {
      const customVars: string[] = [];
      for (const [key, value] of Object.entries(env)) {
        // Only export PORT and custom vars not already in system env
        if (key === "PORT" || !process.env[key]) {
          customVars.push(`export ${key}=${this.shellEscape(value)}`);
        }
      }
      if (customVars.length > 0) {
        envExports = customVars.join("; ") + "; ";
      }
    }

    // Build the shell command
    const shellCommand = `cd ${this.shellEscape(cwd)} && ${envExports}${command}`;

    // Check if this is the first pane (use existing placeholder) or need to split
    const panes = await this.listPanes();
    let paneId: string;

    if (panes.length === 1 && !this.paneMap.size) {
      // First process - respawn the existing pane with our command
      paneId = panes[0].paneId;
      await execFileAsync("tmux", [
        "respawn-pane",
        "-t",
        paneId,
        "-k",  // Kill any existing process
        "sh", "-c", shellCommand,
      ]);
      // Track as first pane of first group for grouped layouts
      if (isGroupedLayout(this.layout)) {
        const firstGroupName = this.groupOrder[0];
        if (firstGroupName) {
          this.groupFirstPanes.set(firstGroupName, paneId);
        }
      }
    } else if (isGroupedLayout(this.layout)) {
      // Grouped layout: split strategically based on group position
      paneId = await this.createPaneForGroup(processName, shellCommand, cwd);
    } else {
      // Simple layout: split and rebalance
      const { stdout } = await execFileAsync("tmux", [
        "split-window",
        "-t",
        this.sessionName,
        "-P",
        "-F",
        "#{pane_id}",
        "-c", cwd,
        "sh", "-c", shellCommand,
      ]);
      paneId = stdout.trim();

      // Rebalance with simple layout
      await this.applyLayout();
    }

    this.paneMap.set(processName, paneId);
    return paneId;
  }

  /**
   * Create a pane for grouped layout, splitting strategically
   */
  private async createPaneForGroup(processName: string, shellCommand: string, cwd: string, groupNameOverride?: string): Promise<string> {
    if (!isGroupedLayout(this.layout) && !groupNameOverride) {
      throw new Error("createPaneForGroup called without grouped layout");
    }

    const position = this.getGroupPosition(processName);
    const groupName = groupNameOverride ?? position?.groupName;
    const posInGroup = position?.posInGroup ?? -1; // -1 means append to end

    if (!groupName) {
      // Process not in any group, just append with default split
      const { stdout } = await execFileAsync("tmux", [
        "split-window",
        "-t",
        this.sessionName,
        "-P",
        "-F",
        "#{pane_id}",
        "-c", cwd,
        "sh", "-c", shellCommand,
      ]);
      return stdout.trim();
    }

    const isRows = isGroupedLayout(this.layout) ? this.layout.type === "rows" : true;

    // Determine split direction:
    // - rows: groups are stacked vertically, items in group are horizontal
    // - columns: groups are side by side, items in group are vertical
    const groupSplitFlag = isRows ? "-v" : "-h";  // Split to create new group
    const itemSplitFlag = isRows ? "-h" : "-v";   // Split within group

    let targetPane: string;
    let splitFlag: string;

    const isFirstInGroup = posInGroup === 0 || !this.groupFirstPanes.has(groupName);
    const isFirstGroup = this.groupOrder.indexOf(groupName) === 0;

    if (isFirstInGroup) {
      // First item in this group
      if (isFirstGroup) {
        // First group, first item - this shouldn't happen (handled by respawn above)
        // But just in case, split from session
        targetPane = this.sessionName;
        splitFlag = itemSplitFlag;
      } else {
        // New group - split from first pane of previous group
        const prevGroupName = this.getPreviousGroupName(groupName);
        const prevGroupFirstPane = prevGroupName ? this.groupFirstPanes.get(prevGroupName) : null;
        if (!prevGroupFirstPane) {
          // Fallback: split from session
          targetPane = this.sessionName;
          splitFlag = groupSplitFlag;
        } else {
          targetPane = prevGroupFirstPane;
          splitFlag = groupSplitFlag;
        }
      }
    } else {
      // Not first in group - split from previous item in same group (or last item if appending)
      let prevPane: string | undefined;

      if (isGroupedLayout(this.layout) && posInGroup >= 0) {
        // Find previous process in this group
        const groupProcesses = this.layout.groups[groupName];
        if (groupProcesses && posInGroup > 0) {
          const prevProcess = groupProcesses[posInGroup - 1];
          prevPane = this.paneMap.get(prevProcess);
        }
      }

      // For dynamic terminals or if prev not found, find last pane in this group
      if (!prevPane) {
        // Find any pane in this group to split from
        const groupFirstPane = this.groupFirstPanes.get(groupName);
        prevPane = groupFirstPane;
      }

      if (!prevPane) {
        // Fallback: split from session
        targetPane = this.sessionName;
        splitFlag = itemSplitFlag;
      } else {
        targetPane = prevPane;
        splitFlag = itemSplitFlag;
      }
    }

    const { stdout } = await execFileAsync("tmux", [
      "split-window",
      splitFlag,
      "-t",
      targetPane,
      "-P",
      "-F",
      "#{pane_id}",
      "-c", cwd,
      "sh", "-c", shellCommand,
    ]);
    const paneId = stdout.trim();

    // Track first pane of each group
    if (isFirstInGroup) {
      this.groupFirstPanes.set(groupName, paneId);
    }

    return paneId;
  }

  /**
   * Create a dynamic pane in a specific group
   * Used for dynamically created terminals
   */
  async createDynamicPane(
    name: string,
    command: string,
    cwd: string,
    groupName: string,
    env?: Record<string, string>
  ): Promise<string> {
    // Build environment exports
    let envExports = "";
    if (env) {
      const customVars: string[] = [];
      for (const [key, value] of Object.entries(env)) {
        if (key === "PORT" || !process.env[key]) {
          customVars.push(`export ${key}=${this.shellEscape(value)}`);
        }
      }
      if (customVars.length > 0) {
        envExports = customVars.join("; ") + "; ";
      }
    }

    const shellCommand = `cd ${this.shellEscape(cwd)} && ${envExports}${command}`;

    // Ensure the group exists in our tracking
    this.addDynamicGroup(groupName);

    // Check if this is the very first pane
    const panes = await this.listPanes();
    let paneId: string;

    if (panes.length === 1 && !this.paneMap.size) {
      // First pane - respawn
      paneId = panes[0].paneId;
      await execFileAsync("tmux", [
        "respawn-pane",
        "-t",
        paneId,
        "-k",
        "sh", "-c", shellCommand,
      ]);
      this.groupFirstPanes.set(groupName, paneId);
    } else {
      // Create pane in the specified group
      paneId = await this.createPaneForGroup(name, shellCommand, cwd, groupName);
    }

    this.paneMap.set(name, paneId);
    return paneId;
  }

  /**
   * Kill a specific pane
   */
  async killPane(processName: string): Promise<void> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return;

    try {
      await execFileAsync("tmux", ["kill-pane", "-t", paneId]);
    } catch {
      // Pane may already be gone
    }

    this.paneMap.delete(processName);
  }

  /**
   * Send keys to a pane (for commands or signals)
   */
  async sendKeys(paneIdOrName: string, keys: string): Promise<void> {
    const paneId = this.paneMap.get(paneIdOrName) ?? paneIdOrName;
    await execFileAsync("tmux", ["send-keys", "-t", paneId, keys, "Enter"]);
  }

  /**
   * Send interrupt signal (Ctrl+C) to a pane
   */
  async sendInterrupt(processName: string): Promise<void> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return;

    await execFileAsync("tmux", ["send-keys", "-t", paneId, "C-c"]);
  }

  /**
   * Capture pane output (logs)
   */
  async capturePane(processName: string, lines = 100): Promise<string> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return "";

    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-t",
        paneId,
        "-p",        // Print to stdout
        "-S",        // Start line
        `-${lines}`, // Negative = from end
      ]);
      return stdout;
    } catch {
      return "";
    }
  }

  /**
   * List all panes in the session with their status
   */
  async listPanes(): Promise<PaneInfo[]> {
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-panes",
        "-t",
        this.sessionName,
        "-F",
        "#{pane_id}:#{pane_pid}:#{pane_dead}:#{pane_dead_status}",
      ]);

      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [paneId, pid, dead, exitStatus] = line.split(":");
          return {
            paneId,
            panePid: parseInt(pid, 10),
            isDead: dead === "1",
            exitStatus: exitStatus ? parseInt(exitStatus, 10) : undefined,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get status of a specific process pane
   */
  async getPaneStatus(processName: string): Promise<PaneInfo | null> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return null;

    const panes = await this.listPanes();
    return panes.find((p) => p.paneId === paneId) ?? null;
  }

  /**
   * Check if a pane exists and is valid
   */
  async paneExists(processName: string): Promise<boolean> {
    const status = await this.getPaneStatus(processName);
    return status !== null;
  }

  /**
   * Apply layout to the session
   * For simple layouts: uses tmux's built-in layout
   * For grouped layouts: already handled by strategic splits
   */
  async applyLayout(layout?: SimpleLayout): Promise<void> {
    // Skip for grouped layouts - splits handle the arrangement
    if (isGroupedLayout(this.layout) && !layout) {
      return;
    }

    // Determine tmux layout name
    let tmuxLayout: string;
    if (layout) {
      tmuxLayout = LAYOUT_TO_TMUX[layout];
    } else if (typeof this.layout === "string") {
      tmuxLayout = LAYOUT_TO_TMUX[this.layout];
    } else {
      return; // Grouped layout, skip
    }

    try {
      await execFileAsync("tmux", [
        "select-layout",
        "-t",
        this.sessionName,
        tmuxLayout,
      ]);
    } catch {
      // Layout may fail if only one pane
    }
  }

  /**
   * Finalize grouped layout after all panes are created
   * Evenly distributes space between groups and within groups
   */
  async finalizeGroupedLayout(): Promise<void> {
    if (!isGroupedLayout(this.layout)) return;

    // Use tiled to evenly distribute, it works well for grid-like arrangements
    try {
      await execFileAsync("tmux", [
        "select-layout",
        "-t",
        this.sessionName,
        "tiled",
      ]);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Respawn a command in an existing (dead) pane
   */
  async respawnPane(processName: string, command: string, cwd: string, env?: Record<string, string>): Promise<void> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return;

    // Build environment export prefix
    let envPrefix = "";
    if (env && Object.keys(env).length > 0) {
      const exports = Object.entries(env)
        .map(([k, v]) => `export ${k}=${this.shellEscape(v)}`)
        .join("; ");
      envPrefix = `${exports}; `;
    }

    const fullCommand = `cd ${this.shellEscape(cwd)} && ${envPrefix}${command}`;

    // Respawn the pane with new command
    try {
      await execFileAsync("tmux", [
        "respawn-pane",
        "-t",
        paneId,
        "-k", // Kill any existing process
        fullCommand,
      ]);
    } catch {
      // If respawn fails, send keys instead
      await this.sendKeys(paneId, fullCommand);
    }
  }

  /**
   * Get the pane ID for a process
   */
  getPaneId(processName: string): string | undefined {
    return this.paneMap.get(processName);
  }

  /**
   * Attach to the session (for CLI use)
   */
  attach(): void {
    // Use spawn with inherit to give user control
    const child = spawn("tmux", ["attach", "-t", this.sessionName], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  }

  /**
   * Shell escape a string for safe use in tmux commands
   */
  private shellEscape(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Run a tmux command
   */
  private async runTmux(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("tmux", args);
    return stdout;
  }

  /**
   * Open a terminal window attached to this tmux session
   * Supports multiple terminal applications: Ghostty, iTerm2, Kitty, Warp, Terminal.app
   */
  async openTerminal(terminalApp?: TerminalApp, cwd?: string): Promise<boolean> {
    const cmd = `tmux attach -t ${this.sessionName}`;
    const insideTmux = isInsideTmux();

    // Check if session already has a client attached (prevent duplicate windows)
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-clients", "-t", this.sessionName, "-F", "#{client_name}"
      ]);
      if (stdout.trim()) {
        console.error(`[sidecar] Terminal already attached to ${this.sessionName}`);
        return true;
      }
    } catch {
      // No clients or session doesn't exist, continue
    }

    // Handle explicit "tmux" setting
    if (terminalApp === "tmux") {
      if (insideTmux) {
        return this.openInTmuxWindow(cmd);
      } else {
        console.error(`[sidecar] Not inside tmux. Attach with: ${cmd}`);
        return false;
      }
    }

    // Handle "auto" - detect tmux first, then fall through to external terminal
    if (terminalApp === "auto" || !terminalApp) {
      if (insideTmux) {
        console.error("[sidecar] Detected tmux environment, creating window");
        return this.openInTmuxWindow(cmd);
      }
      // Fall through to external terminal detection below
    }

    // External terminals only supported on macOS
    if (process.platform !== "darwin") {
      console.error(`[sidecar] Auto-attach only supported on macOS. Run: ${cmd}`);
      return false;
    }

    const terminal = terminalApp === "auto" || !terminalApp ? detectTerminal() : terminalApp;
    console.error(`[sidecar] Opening terminal: ${terminal}`);

    switch (terminal) {
      case "ghostty":
        return this.openInGhostty(cmd);
      case "iterm":
        return this.openInITerm(cmd);
      case "kitty":
        return this.openInKitty(cmd);
      default:
        return this.openInTerminalApp(cmd);
    }
  }

  /**
   * Open sidecar session in a new window of the current tmux session
   * Only works when already inside tmux
   */
  private async openInTmuxWindow(attachCmd: string): Promise<boolean> {
    if (!process.env.TMUX) {
      console.error("[sidecar] Not inside tmux, cannot create window");
      return false;
    }

    try {
      // Create new window in current session that runs the attach command
      await execFileAsync("tmux", [
        "new-window",
        "-n", "sidecar",  // Window name
        attachCmd,        // Command: "tmux attach -t sidecar-xxx"
      ]);
      console.error(`[sidecar] Created tmux window attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      console.error("[sidecar] Failed to create tmux window:", err);
      return false;
    }
  }

  /**
   * Open Ghostty with command
   */
  private openInGhostty(command: string): boolean {
    try {
      const title = `Sidecar: ${this.sessionName}`;
      spawn("open", ["-na", "Ghostty.app", "--args", "--title", title, "-e", "/bin/bash", "-c", command], {
        detached: true,
        stdio: "ignore",
      }).unref();
      console.error(`[sidecar] Opened Ghostty attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      console.error(`[sidecar] Failed to open Ghostty: ${err}`);
      return false;
    }
  }

  /**
   * Open iTerm2 with command via AppleScript
   */
  private openInITerm(command: string): boolean {
    try {
      const title = `Sidecar: ${this.sessionName}`;
      // Escape double quotes in command for AppleScript
      const escapedCommand = command.replace(/"/g, '\\"');
      const script = `
tell application "iTerm2"
  create window with default profile
  tell current session of current window
    set name to "${title}"
    write text "${escapedCommand}"
  end tell
end tell`;
      spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
      console.error(`[sidecar] Opened iTerm2 attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      console.error(`[sidecar] Failed to open iTerm2: ${err}`);
      return false;
    }
  }

  /**
   * Open Kitty with command
   */
  private openInKitty(command: string): boolean {
    const title = `Sidecar: ${this.sessionName}`;
    try {
      // Try kitty in PATH first, fall back to full path
      spawn("kitty", ["--title", title, "-e", "/bin/bash", "-c", command], {
        detached: true,
        stdio: "ignore",
      }).unref();
      console.error(`[sidecar] Opened Kitty attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      // Try full path as fallback
      try {
        spawn("/Applications/kitty.app/Contents/MacOS/kitty", ["--title", title, "-e", "/bin/bash", "-c", command], {
          detached: true,
          stdio: "ignore",
        }).unref();
        console.error(`[sidecar] Opened Kitty attached to ${this.sessionName}`);
        return true;
      } catch (err2) {
        console.error(`[sidecar] Failed to open Kitty: ${err2}`);
        return false;
      }
    }
  }

  /**
   * Open Terminal.app with command (fallback)
   */
  private async openInTerminalApp(command: string): Promise<boolean> {
    try {
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");

      // Create a temporary .command script
      const scriptPath = path.join(os.tmpdir(), `sidecar-attach-${this.sessionName}.command`);
      const script = `#!/bin/bash\n${command}\n`;
      fs.writeFileSync(scriptPath, script, { mode: 0o755 });

      // Open it with default terminal
      spawn("open", [scriptPath], { detached: true, stdio: "ignore" }).unref();

      console.error(`[sidecar] Opened Terminal.app attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      console.error(`[sidecar] Failed to open Terminal.app: ${err}`);
      return false;
    }
  }
}

