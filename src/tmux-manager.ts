import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import {
  Dashboard,
  normalizeDashboardPane,
  normalizeDashboardToRows,
  isDashboardNested,
  TabsConfig,
  getTabType,
  normalizeTabToService,
} from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Get the log directory for a session
 * sessionName already has "mide-" prefix from TmuxManager
 */
export function getSessionLogDir(sessionName: string): string {
  return `/tmp/${sessionName}`;
}

/**
 * Get the log file path for a service
 */
export function getServiceLogPath(sessionName: string, serviceName: string): string {
  return path.join(getSessionLogDir(sessionName), `${serviceName}.log`);
}

/**
 * Get the events file path for a session
 */
export function getEventsFilePath(sessionName: string): string {
  return path.join(getSessionLogDir(sessionName), "events.jsonl");
}

/**
 * Get the owner file path for a session
 */
function getOwnerFilePath(sessionName: string): string {
  return path.join(getSessionLogDir(sessionName), ".owner");
}

/**
 * Write owner PID to session directory
 */
function writeOwnerPid(sessionName: string): void {
  const ownerFile = getOwnerFilePath(sessionName);
  try {
    fs.writeFileSync(ownerFile, String(process.pid));
  } catch {
    // Ignore - directory might not exist yet
  }
}

/**
 * Read owner PID from session directory
 */
function readOwnerPid(sessionName: string): number | null {
  const ownerFile = getOwnerFilePath(sessionName);
  try {
    if (fs.existsSync(ownerFile)) {
      const content = fs.readFileSync(ownerFile, "utf-8").trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Check if a process with the given PID is running
 */
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an existing session is stale (owner process is dead)
 */
export function isSessionStale(sessionName: string): boolean {
  const ownerPid = readOwnerPid(sessionName);
  if (ownerPid === null) {
    // No owner file - could be old session, check log directory age
    const logDir = getSessionLogDir(sessionName);
    try {
      if (fs.existsSync(logDir)) {
        const stats = fs.statSync(logDir);
        const ageMs = Date.now() - stats.mtimeMs;
        // Consider sessions older than 5 minutes without owner file as stale
        return ageMs > 5 * 60 * 1000;
      }
    } catch {
      // Ignore
    }
    return false;
  }
  // Session is stale if owner PID is not running
  return !isPidRunning(ownerPid);
}

/**
 * Clean up a stale session (kill tmux session and remove logs)
 */
export async function cleanupStaleSession(sessionName: string): Promise<void> {
  console.error(`[mide] Cleaning up stale session: ${sessionName}`);
  try {
    await execFileAsync("tmux", ["kill-session", "-t", sessionName]);
  } catch {
    // Session may already be gone
  }
  const logDir = getSessionLogDir(sessionName);
  try {
    fs.rmSync(logDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

export type IdeStatus = "pending" | "running" | "completed" | "failed";

const STATUS_ICONS: Record<IdeStatus, string> = {
  pending: "⏳",
  running: "🔄",
  completed: "✅",
  failed: "❌",
};

/**
 * Check if we're running inside a tmux session
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export interface PaneInfo {
  paneId: string;
  panePid: number;
  isDead: boolean;
  exitStatus?: number;
}

export interface TmuxManagerOptions {
  sessionPrefix?: string;
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
 * Get all active IDE tmux sessions
 */
export async function listIdeSessions(prefix = "mide"): Promise<Array<{ name: string; windows: number; created: Date; clients: number; ownerPid: number | null; isStale: boolean }>> {
  try {
    // Get sessions
    const { stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}:#{session_windows}:#{session_created}",
    ]);

    // Get client counts per session
    let clientCounts: Map<string, number> = new Map();
    try {
      const { stdout: clientsOut } = await execFileAsync("tmux", [
        "list-clients",
        "-F",
        "#{client_session}",
      ]);
      for (const sessionName of clientsOut.trim().split("\n").filter(Boolean)) {
        clientCounts.set(sessionName, (clientCounts.get(sessionName) || 0) + 1);
      }
    } catch {
      // No clients or error - counts stay at 0
    }

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => {
        const [name, windows, created] = line.split(":");
        const ownerPid = readOwnerPid(name);
        return {
          name,
          windows: parseInt(windows, 10),
          created: new Date(parseInt(created, 10) * 1000),
          clients: clientCounts.get(name) || 0,
          ownerPid,
          isStale: isSessionStale(name),
        };
      });
  } catch {
    // No sessions or tmux not running
    return [];
  }
}

/**
 * Get the current tmux session name from tmux
 * Returns null if not inside tmux
 */
export async function getCurrentTmuxSession(): Promise<string | null> {
  if (!process.env.TMUX) return null;

  try {
    const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "#{session_name}"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Manages panes in the user's current tmux session (embedded mode)
 * Used when claude-ide is running inside an existing tmux session
 */
export class EmbeddedTmuxManager {
  private paneMap = new Map<string, string>(); // name -> paneId
  private sessionName: string;
  private sourcePaneId: string; // The pane where Claude is running

  private constructor(sessionName: string, sourcePaneId: string) {
    this.sessionName = sessionName;
    this.sourcePaneId = sourcePaneId;
  }

  /**
   * Create an EmbeddedTmuxManager (async factory)
   */
  static async create(): Promise<EmbeddedTmuxManager> {
    const session = await getCurrentTmuxSession();
    if (!session) {
      throw new Error("EmbeddedTmuxManager requires running inside tmux");
    }

    // Use $TMUX_PANE - this is the pane ID where Claude is running
    let sourcePaneId = process.env.TMUX_PANE || "";

    // Fallback: if TMUX_PANE not set, get the active pane of the current window
    if (!sourcePaneId) {
      try {
        // Get the active pane ID from the session's current window
        const { stdout } = await execFileAsync("tmux", [
          "display-message", "-t", session, "-p", "#{pane_id}"
        ]);
        sourcePaneId = stdout.trim();
        if (sourcePaneId) {
          console.error(`[mide] Embedded mode: session=${session}, sourcePaneId=${sourcePaneId} (fallback via display-message)`);
        }
      } catch {
        console.error(`[mide] Warning: Could not get active pane for session ${session}`);
      }
    } else {
      console.error(`[mide] Embedded mode: session=${session}, sourcePaneId=${sourcePaneId}`);
    }

    return new EmbeddedTmuxManager(session, sourcePaneId);
  }

  /**
   * Get the session name
   */
  getSessionName(): string {
    return this.sessionName;
  }

  /**
   * Get the dimensions of the source pane (where Claude is running)
   * Used for smart "auto" direction detection
   */
  private async getPaneDimensions(): Promise<{ width: number; height: number }> {
    const target = this.sourcePaneId || "";
    const args = target
      ? ["display-message", "-t", target, "-p", "#{pane_width} #{pane_height}"]
      : ["display-message", "-p", "#{pane_width} #{pane_height}"];

    const { stdout } = await execFileAsync("tmux", args);
    const [widthStr, heightStr] = stdout.trim().split(" ");
    return {
      width: parseInt(widthStr, 10) || 80,
      height: parseInt(heightStr, 10) || 24,
    };
  }

  /**
   * Create a new pane with split in the current window
   * @param name - Unique name for the pane
   * @param command - Command to run in the pane
   * @param cwd - Working directory
   * @param env - Environment variables to set
   * @param options - Split options: direction ('auto' | 'right' | 'left' | 'top' | 'bottom'), skipRebalance
   */
  async createPane(
    name: string,
    command: string,
    cwd: string,
    env?: Record<string, string>,
    options?: { direction?: "auto" | "right" | "left" | "top" | "bottom"; skipRebalance?: boolean }
  ): Promise<string> {
    if (this.paneMap.has(name)) {
      throw new Error(`Pane "${name}" already exists`);
    }

    // Resolve "auto" direction based on pane dimensions
    let direction: "right" | "left" | "top" | "bottom" = "right";
    const requestedDirection = options?.direction ?? "auto";

    if (requestedDirection === "auto") {
      // Smart detection: split along the longer axis
      const { width, height } = await this.getPaneDimensions();
      direction = width >= height ? "right" : "bottom";
      console.error(`[mide] Auto-detected split direction: ${direction} (pane: ${width}x${height})`);
    } else {
      direction = requestedDirection;
    }
    const skipRebalance = options?.skipRebalance ?? false;

    // Build environment exports for custom vars
    let envExports = "";
    if (env) {
      const customVars: string[] = [];
      for (const [key, value] of Object.entries(env)) {
        // Only export custom vars not already in system env
        if (!process.env[key]) {
          customVars.push(`export ${key}=${this.shellEscape(value)}`);
        }
      }
      if (customVars.length > 0) {
        envExports = customVars.join("; ") + "; ";
      }
    }

    const shellCommand = `cd ${this.shellEscape(cwd)} && ${envExports}${command}`;

    // Build split-window args
    const args = ["split-window"];

    // Target Claude's pane directly if we have it
    if (this.sourcePaneId) {
      args.push("-t", this.sourcePaneId);
    }

    // Direction flags:
    // -h = horizontal split, -v = vertical split
    // -b = before (left/top instead of right/bottom)
    switch (direction) {
      case "right":
        args.push("-h");
        break;
      case "left":
        args.push("-h", "-b");
        break;
      case "bottom":
        args.push("-v");
        break;
      case "top":
        args.push("-v", "-b");
        break;
    }

    args.push(
      "-P",           // Print pane info
      "-F", "#{pane_id}",
      "-c", cwd,
      "sh", "-c", shellCommand
    );

    const { stdout } = await execFileAsync("tmux", args);
    const paneId = stdout.trim();
    this.paneMap.set(name, paneId);

    // Re-balance layout so all panes are evenly distributed (unless skipped)
    if (!skipRebalance) {
      try {
        if (this.sourcePaneId) {
          await execFileAsync("tmux", ["select-layout", "-t", this.sourcePaneId, "tiled"]);
        } else {
          await execFileAsync("tmux", ["select-layout", "tiled"]);
        }
      } catch {
        // Layout change might fail, that's ok
      }
    }

    console.error(`[mide] Created embedded pane: ${name} (${paneId})`);
    return paneId;
  }

  /**
   * Kill a pane by name
   */
  async killPane(name: string): Promise<void> {
    const paneId = this.paneMap.get(name);
    if (!paneId) return;

    try {
      await execFileAsync("tmux", ["kill-pane", "-t", paneId]);
    } catch {
      // Pane might already be gone
    }
    this.paneMap.delete(name);
  }

  /**
   * Get pane ID by name
   */
  getPaneId(name: string): string | undefined {
    return this.paneMap.get(name);
  }

  /**
   * Check if a pane exists
   */
  hasPane(name: string): boolean {
    return this.paneMap.has(name);
  }

  /**
   * Check if a pane exists (async version for TmuxManager compatibility)
   */
  async paneExists(name: string): Promise<boolean> {
    return this.paneMap.has(name);
  }

  /**
   * Capture pane output (alias for getPaneLogs for TmuxManager compatibility)
   */
  async capturePane(name: string, lines = 100): Promise<string> {
    return this.getPaneLogs(name, lines);
  }

  /**
   * Set the status (updates current window title)
   */
  async setStatus(status: IdeStatus, message?: string): Promise<void> {
    const icon = STATUS_ICONS[status];
    const title = message
      ? `${icon} MIDE: ${message}`
      : `${icon} MIDE`;

    try {
      await execFileAsync("tmux", ["rename-window", title]);
    } catch (err) {
      console.error(`[mide] Failed to set status: ${err}`);
    }
  }

  /**
   * Get logs from a pane
   */
  async getPaneLogs(name: string, lines = 100): Promise<string> {
    const paneId = this.paneMap.get(name);
    if (!paneId) return "";

    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-t", paneId,
        "-p",           // Print to stdout
        "-S", `-${lines}`,  // Start from N lines back
      ]);
      return stdout;
    } catch {
      return "";
    }
  }

  /**
   * Send keys to a pane
   */
  async sendKeys(paneIdOrName: string, keys: string): Promise<void> {
    const paneId = this.paneMap.get(paneIdOrName) ?? paneIdOrName;
    await execFileAsync("tmux", ["send-keys", "-t", paneId, keys, "Enter"]);
  }

  /**
   * Stop all panes
   */
  async stopAll(): Promise<void> {
    for (const [name] of this.paneMap) {
      await this.killPane(name);
    }
  }

  private shellEscape(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }
}

/**
 * Manages a tmux session for process orchestration
 */
export class TmuxManager {
  readonly sessionName: string;
  private paneMap = new Map<string, string>(); // processName -> paneId

  constructor(projectName: string, options: TmuxManagerOptions = {}) {
    const prefix = options.sessionPrefix ?? "mide";
    this.sessionName = `${prefix}-${this.sanitizeName(projectName)}`;
  }

  /**
   * Register a pane in the pane map
   */
  registerPane(name: string, paneId: string): void {
    this.paneMap.set(name, paneId);
  }

  /**
   * Unregister a pane from the pane map
   */
  unregisterPane(name: string): void {
    this.paneMap.delete(name);
  }

  /**
   * Get pane ID by name
   */
  getPaneId(name: string): string | undefined {
    return this.paneMap.get(name);
  }

  /**
   * Check if a pane exists
   */
  hasPane(name: string): boolean {
    return this.paneMap.has(name);
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
   * Get paneId for an existing window by name
   * Returns undefined if window doesn't exist
   */
  async getWindowPaneId(windowName: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-windows", "-t", this.sessionName, "-F", "#{window_name}:#{pane_id}"
      ]);
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const [name, paneId] = line.split(":");
        if (name === windowName) {
          // Update pane map
          this.paneMap.set(windowName, paneId);
          return paneId;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Discover and populate paneIds for all windows in the session
   * Returns map of windowName -> paneId
   */
  async discoverWindows(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-windows", "-t", this.sessionName, "-F", "#{window_name}:#{pane_id}"
      ]);
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const [name, paneId] = line.split(":");
        if (name && paneId) {
          result.set(name, paneId);
          this.paneMap.set(name, paneId);
        }
      }
    } catch {
      // Session may not exist
    }
    return result;
  }

  /**
   * Discover window indices for all windows in the session
   * Returns map of windowName -> windowIndex
   */
  async discoverWindowIndices(): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-windows", "-t", this.sessionName, "-F", "#{window_name}:#{window_index}"
      ]);
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const [name, indexStr] = line.split(":");
        if (name && indexStr) {
          result.set(name, parseInt(indexStr, 10));
        }
      }
    } catch {
      // Session may not exist
    }
    return result;
  }

  /**
   * Discover panes in window 0 (Canvas) by their titles
   * Returns map of paneTitle -> paneId
   */
  async discoverCanvasPanes(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-panes", "-t", `${this.sessionName}:0`, "-F", "#{pane_title}:#{pane_id}"
      ]);
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const colonIdx = line.lastIndexOf(":");
        if (colonIdx > 0) {
          const title = line.substring(0, colonIdx);
          const paneId = line.substring(colonIdx + 1);
          // Skip default titles (hostname, empty, etc)
          if (title && paneId && !title.includes(".") && title !== "zsh" && title !== "bash") {
            result.set(title, paneId);
            this.paneMap.set(title, paneId);
          }
        }
      }
    } catch {
      // Window may not exist
    }
    return result;
  }

  /**
   * Create a new tmux session (detached)
   * Returns the final session name (may have suffix if collision)
   */
  async createSession(): Promise<string> {
    // Check for stale sessions from previous crashes and clean them up
    try {
      await execFileAsync("tmux", ["has-session", "-t", this.sessionName]);
      // Session exists - check if it's stale (owner process is dead)
      if (isSessionStale(this.sessionName)) {
        await cleanupStaleSession(this.sessionName);
      }
    } catch {
      // Session doesn't exist, continue
    }

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
        console.error(`[mide] Reusing existing session: ${this.sessionName} (created ${Math.round(ageMs / 1000)}s ago)`);
        // Update owner PID to current process
        writeOwnerPid(this.sessionName);
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
      "mide",
      // Keep pane alive after command exits to capture exit status
      "-x", "200", // Set initial width
      "-y", "50",  // Set initial height
    ]);

    // Configure session options
    await this.runTmux(["set-option", "-t", finalName, "remain-on-exit", "on"]);
    await this.runTmux(["set-option", "-t", finalName, "history-limit", "50000"]);
    // Enable set-titles globally so terminal window title syncs with tmux window name
    // This is a global option but is generally benign - it just makes terminal titles more useful
    try {
      const { stdout } = await execFileAsync("tmux", ["show-options", "-gv", "set-titles"]);
      if (stdout.trim() !== "on") {
        await this.runTmux(["set-option", "-g", "set-titles", "on"]);
        await this.runTmux(["set-option", "-g", "set-titles-string", "#{window_name}"]);
      }
    } catch {
      // Ignore - set-titles might not be available or already configured
    }

    // Update session name if we had to use suffix
    if (finalName !== this.sessionName) {
      (this as { sessionName: string }).sessionName = finalName;
    }

    // Create log directory for this session
    const logDir = getSessionLogDir(finalName);
    fs.mkdirSync(logDir, { recursive: true });

    // Initialize empty events file
    const eventsFile = getEventsFilePath(finalName);
    fs.writeFileSync(eventsFile, "", { flag: "w" });

    // Write owner PID for stale session detection
    writeOwnerPid(finalName);

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

    // Clean up log directory
    const logDir = getSessionLogDir(this.sessionName);
    try {
      fs.rmSync(logDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Create a new window (tab) for a service
   * Services run in separate windows for better organization
   * Output is piped to log file for persistence
   * Returns the pane ID of the new window
   */
  async createServiceWindow(
    serviceName: string,
    command: string,
    cwd: string,
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

    // Create new window for this service
    const { stdout } = await execFileAsync("tmux", [
      "new-window",
      "-t", this.sessionName,
      "-n", serviceName,       // Window name = service name
      "-P",                    // Print window info
      "-F", "#{pane_id}",      // Return pane ID
      "-c", cwd,
      "sh", "-c", shellCommand,
    ]);
    const paneId = stdout.trim();

    // Set remain-on-exit so pane stays visible after process exits (for crash logs)
    try {
      await execFileAsync("tmux", [
        "set-option",
        "-t", paneId,
        "remain-on-exit", "on",
      ]);
    } catch {
      // Ignore - option might already be set
    }

    // Set up pipe-pane to redirect output to log file
    const logFile = getServiceLogPath(this.sessionName, serviceName);
    try {
      await execFileAsync("tmux", [
        "pipe-pane",
        "-t", paneId,
        "-o",                  // Append mode
        `cat >> ${this.shellEscape(logFile)}`,
      ]);
    } catch (err) {
      console.error(`[mide] Warning: Failed to set up pipe-pane for ${serviceName}: ${err}`);
    }

    this.paneMap.set(serviceName, paneId);
    return paneId;
  }

  /**
   * Create a new window with a multi-pane layout (for layout tabs)
   * Returns the window index
   */
  async createLayoutTab(
    tabName: string,
    layout: Dashboard,
    cwd: string
  ): Promise<number> {
    if (layout.length === 0) {
      throw new Error(`Layout tab "${tabName}" has no panes defined`);
    }

    const isNested = isDashboardNested(layout);
    const rows = normalizeDashboardToRows(layout);

    // Get first pane info
    const firstRow = rows[0];
    const firstPane = normalizeDashboardPane(firstRow[0]);

    // Create new window with first pane
    const { stdout: windowOut } = await execFileAsync("tmux", [
      "new-window",
      "-t", this.sessionName,
      "-n", tabName,
      "-P",
      "-F", "#{window_index}:#{pane_id}",
      "-c", cwd,
      "sh", "-c", `cd ${this.shellEscape(cwd)} && ${firstPane.command}`,
    ]);
    const [windowIndexStr, initialPaneId] = windowOut.trim().split(":");
    const windowIndex = parseInt(windowIndexStr, 10);

    // Register first pane
    this.paneMap.set(`${tabName}:${firstPane.name}`, initialPaneId);

    // Track pane IDs for layout application
    const paneIds: string[] = [initialPaneId];

    if (isNested) {
      // Nested layout: create rows of columns
      const rowFirstPanes: string[] = [initialPaneId];

      // Create additional rows (split from initial pane vertically)
      for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const firstPaneInRow = normalizeDashboardPane(row[0]);

        const { stdout } = await execFileAsync("tmux", [
          "split-window",
          "-t", initialPaneId,
          "-v",
          "-P",
          "-F", "#{pane_id}",
          "-c", cwd,
          "sh", "-c", `cd ${this.shellEscape(cwd)} && ${firstPaneInRow.command}`,
        ]);
        const newPaneId = stdout.trim();
        this.paneMap.set(`${tabName}:${firstPaneInRow.name}`, newPaneId);
        paneIds.push(newPaneId);
        rowFirstPanes.push(newPaneId);
      }

      // Create columns within each row
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const rowPaneId = rowFirstPanes[rowIdx];

        for (let colIdx = 1; colIdx < row.length; colIdx++) {
          const pane = normalizeDashboardPane(row[colIdx]);

          const { stdout } = await execFileAsync("tmux", [
            "split-window",
            "-t", rowPaneId,
            "-h",
            "-P",
            "-F", "#{pane_id}",
            "-c", cwd,
            "sh", "-c", `cd ${this.shellEscape(cwd)} && ${pane.command}`,
          ]);
          const newPaneId = stdout.trim();
          this.paneMap.set(`${tabName}:${pane.name}`, newPaneId);
          paneIds.push(newPaneId);
        }
      }

      // Balance layout within each row
      for (const rowPaneId of rowFirstPanes) {
        try {
          await execFileAsync("tmux", [
            "select-layout", "-t", rowPaneId, "even-horizontal",
          ]);
        } catch {
          // Ignore - might be single pane row
        }
      }
    } else {
      // Flat layout: create panes and apply tiled
      const flatPanes = rows[0];

      for (let i = 1; i < flatPanes.length; i++) {
        const pane = normalizeDashboardPane(flatPanes[i]);

        const { stdout } = await execFileAsync("tmux", [
          "split-window",
          "-t", `${this.sessionName}:${windowIndex}`,
          "-h",
          "-P",
          "-F", "#{pane_id}",
          "-c", cwd,
          "sh", "-c", `cd ${this.shellEscape(cwd)} && ${pane.command}`,
        ]);
        const newPaneId = stdout.trim();
        this.paneMap.set(`${tabName}:${pane.name}`, newPaneId);
        paneIds.push(newPaneId);
      }

      // Apply tiled layout for even distribution
      try {
        await execFileAsync("tmux", [
          "select-layout", "-t", `${this.sessionName}:${windowIndex}`, "tiled",
        ]);
      } catch {
        // Ignore - might be single pane
      }
    }

    return windowIndex;
  }

  /**
   * Create all tabs from config
   * Returns map of tab name to window index
   */
  async createAllTabs(
    tabs: TabsConfig,
    cwd: string,
    onServiceCreated?: (name: string, paneId: string, windowIndex: number) => void
  ): Promise<Map<string, number>> {
    const tabIndices = new Map<string, number>();

    for (const [tabName, tabConfig] of Object.entries(tabs)) {
      const tabType = getTabType(tabConfig);

      if (tabType === "layout") {
        // Layout tab: create window with multi-pane layout
        const windowIndex = await this.createLayoutTab(tabName, tabConfig as Dashboard, cwd);
        tabIndices.set(tabName, windowIndex);
        console.error(`[mide] Created layout tab "${tabName}" at window ${windowIndex}`);
      } else {
        // Service tab: create window with single pane
        const processConfig = normalizeTabToService(tabName, tabConfig);
        if (!processConfig) continue;

        const paneId = await this.createServiceWindow(
          tabName,
          processConfig.command,
          processConfig.cwd ? path.resolve(cwd, processConfig.cwd) : cwd,
          processConfig.env
        );

        // Get window index for this tab
        const { stdout } = await execFileAsync("tmux", [
          "display-message", "-t", paneId, "-p", "#{window_index}",
        ]);
        const windowIndex = parseInt(stdout.trim(), 10);
        tabIndices.set(tabName, windowIndex);

        if (onServiceCreated) {
          onServiceCreated(tabName, paneId, windowIndex);
        }

        console.error(`[mide] Created service tab "${tabName}" at window ${windowIndex}`);
      }
    }

    return tabIndices;
  }

  /**
   * Kill all tab windows (windows 1+), preserving window 0 (mide/welcome)
   */
  async killAllTabWindows(): Promise<void> {
    try {
      // List all windows except window 0
      const { stdout } = await execFileAsync("tmux", [
        "list-windows",
        "-t", this.sessionName,
        "-F", "#{window_index}",
      ]);

      const windowIndices = stdout.trim().split("\n")
        .map(s => parseInt(s, 10))
        .filter(idx => !isNaN(idx) && idx > 0) // Skip window 0
        .sort((a, b) => b - a); // Kill in reverse order to avoid index shifting

      for (const idx of windowIndices) {
        try {
          await execFileAsync("tmux", [
            "kill-window",
            "-t", `${this.sessionName}:${idx}`,
          ]);
        } catch {
          // Window may already be gone
        }
      }

      // Clear pane map entries for killed windows
      this.paneMap.clear();
    } catch (err) {
      console.error(`[mide] Error killing tab windows: ${err}`);
    }
  }

  /**
   * Create a new pane for a process
   * Returns the pane ID
   */
  async createPane(
    processName: string,
    command: string,
    cwd: string,
    env?: Record<string, string>,
    _options?: { direction?: "right" | "left" | "top" | "bottom"; skipRebalance?: boolean }
  ): Promise<string> {
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
    } else {
      // Split and rebalance
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

      // Rebalance with tiled layout
      await this.applyLayout();
    }

    this.paneMap.set(processName, paneId);
    return paneId;
  }

  /**
   * Create a dynamic pane in window 0
   * Used for dynamically created terminals
   */
  async createDynamicPane(
    name: string,
    command: string,
    cwd: string,
    _groupName: string,
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

    // Always create dynamic panes in window 0 (mide/dashboard window)
    // This keeps the architecture simple: services = windows, interactions = panes in window 0
    const { stdout } = await execFileAsync("tmux", [
      "split-window",
      "-t", `${this.sessionName}:0`,  // Target window 0 (mide)
      "-h",                            // Horizontal split (right side)
      "-P",
      "-F", "#{pane_id}",
      "-c", cwd,
      "sh", "-c", shellCommand,
    ]);
    const paneId = stdout.trim();

    // Set pane title for recovery on reconnect
    try {
      await execFileAsync("tmux", ["select-pane", "-t", paneId, "-T", name]);
    } catch {
      // Non-fatal if title can't be set
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
   * Uses -s flag to list panes across all windows in the session
   */
  async listPanes(): Promise<PaneInfo[]> {
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-panes",
        "-t",
        this.sessionName,
        "-s",  // List all panes in session (all windows), not just current window
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
   * Apply tiled layout to the session
   */
  async applyLayout(): Promise<void> {
    try {
      await execFileAsync("tmux", [
        "select-layout",
        "-t",
        this.sessionName,
        "tiled",
      ]);
    } catch {
      // Layout may fail if only one pane
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
   * Select a pane by name (for CLI attach with specific pane)
   */
  async selectPane(paneName: string): Promise<boolean> {
    const paneId = this.paneMap.get(paneName);
    if (!paneId) {
      // Try to find by listing all panes
      const panes = await this.listPanes();
      const match = panes.find(p => p.paneId === paneName);
      if (!match) {
        console.error(`[mide] Pane "${paneName}" not found`);
        return false;
      }
    }

    const targetId = paneId || paneName;
    try {
      await execFileAsync("tmux", ["select-pane", "-t", targetId]);
      return true;
    } catch (err) {
      console.error(`[mide] Failed to select pane: ${err}`);
      return false;
    }
  }

  /**
   * Attach to the session (for CLI use)
   * Returns a promise that resolves when tmux exits
   */
  attach(): Promise<number> {
    // Select window 0 (dashboard) before attaching
    try {
      execFileSync("tmux", ["select-window", "-t", `${this.sessionName}:0`]);
    } catch {
      // Ignore - window might not exist yet
    }

    return new Promise((resolve) => {
      const child = spawn("tmux", ["attach", "-t", this.sessionName], {
        stdio: "inherit",
      });

      child.on("exit", (code) => {
        resolve(code ?? 0);
      });

      child.on("error", (err) => {
        console.error(`[mide] Failed to attach: ${err}`);
        resolve(1);
      });
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
   * Set the MIDE status displayed in the terminal window title
   */
  async setStatus(status: IdeStatus, message?: string): Promise<void> {
    const icon = STATUS_ICONS[status];
    const title = message
      ? `${icon} MIDE: ${message}`
      : `${icon} MIDE`;

    try {
      // Set tmux window name (visible in tmux status bar and terminal title if set-titles is on)
      await execFileAsync("tmux", [
        "rename-window", "-t", this.sessionName,
        title
      ]);
    } catch (err) {
      console.error(`[mide] Failed to set status: ${err}`);
    }
  }

  // ==================== Dashboard Methods ====================

  /**
   * Get all pane IDs in window 0 (mide/dashboard window)
   */
  async getWindow0PaneIds(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-panes",
        "-t", `${this.sessionName}:0`,
        "-F", "#{pane_id}",
      ]);
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Check if window 0 has only one pane (welcome component or initial pane)
   */
  async isOnlyWelcomePane(): Promise<boolean> {
    const panes = await this.getWindow0PaneIds();
    return panes.length === 1;
  }

  /**
   * Get the initial pane ID from window 0
   */
  async getWindow0InitialPaneId(): Promise<string | null> {
    const panes = await this.getWindow0PaneIds();
    return panes[0] || null;
  }

  /**
   * Create dashboard layout in window 0
   *
   * For flat arrays [a, b, c, d]: creates panes and applies tiled layout
   * For nested arrays [[a, b], [c, d]]: creates rows of columns
   *
   * @param dashboard - Dashboard configuration from mide.yaml
   * @param cwd - Working directory for commands
   */
  async createDashboardLayout(dashboard: Dashboard, cwd: string): Promise<void> {
    if (dashboard.length === 0) return;

    const isNested = isDashboardNested(dashboard);
    const rows = normalizeDashboardToRows(dashboard);

    // Track pane IDs for layout application
    const paneIds: string[] = [];

    // Get the initial pane ID (window 0 starts with one pane)
    const initialPaneId = await this.getWindow0InitialPaneId();
    if (!initialPaneId) {
      console.error("[mide] No initial pane found in window 0");
      return;
    }

    // First pane: respawn the initial pane with first command
    const firstRow = rows[0];
    const firstPane = normalizeDashboardPane(firstRow[0]);

    // Register in paneMap first so respawnPane can find it
    this.paneMap.set(firstPane.name, initialPaneId);
    await this.respawnPane(firstPane.name, firstPane.command, cwd);
    paneIds.push(initialPaneId);

    if (isNested) {
      // Nested layout: create rows of columns
      // Algorithm:
      // 1. Start with initial pane (row 0, col 0)
      // 2. Split vertically for each additional row
      // 3. For each row, split horizontally for additional columns

      // Store row pane IDs (first pane of each row)
      const rowFirstPanes: string[] = [initialPaneId];

      // Create additional rows (split from initial pane vertically)
      for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const firstPaneInRow = normalizeDashboardPane(row[0]);

        const { stdout } = await execFileAsync("tmux", [
          "split-window",
          "-t", initialPaneId,
          "-v",  // Vertical split (creates row below)
          "-P",
          "-F", "#{pane_id}",
          "-c", cwd,
          "sh", "-c", `cd ${this.shellEscape(cwd)} && ${firstPaneInRow.command}`,
        ]);
        const newPaneId = stdout.trim();
        this.paneMap.set(firstPaneInRow.name, newPaneId);
        paneIds.push(newPaneId);
        rowFirstPanes.push(newPaneId);
      }

      // Now create columns within each row
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const rowPaneId = rowFirstPanes[rowIdx];

        // Skip first pane in row (already created)
        for (let colIdx = 1; colIdx < row.length; colIdx++) {
          const pane = normalizeDashboardPane(row[colIdx]);

          const { stdout } = await execFileAsync("tmux", [
            "split-window",
            "-t", rowPaneId,
            "-h",  // Horizontal split (creates column to the right)
            "-P",
            "-F", "#{pane_id}",
            "-c", cwd,
            "sh", "-c", `cd ${this.shellEscape(cwd)} && ${pane.command}`,
          ]);
          const newPaneId = stdout.trim();
          this.paneMap.set(pane.name, newPaneId);
          paneIds.push(newPaneId);
        }
      }

      // Balance the layout within each row
      for (const rowPaneId of rowFirstPanes) {
        try {
          await execFileAsync("tmux", [
            "select-layout", "-t", rowPaneId, "even-horizontal",
          ]);
        } catch {
          // Ignore - might be single pane row
        }
      }
    } else {
      // Flat layout: create panes and apply tiled
      const flatPanes = rows[0]; // Single row contains all panes

      for (let i = 1; i < flatPanes.length; i++) {
        const pane = normalizeDashboardPane(flatPanes[i]);

        const { stdout } = await execFileAsync("tmux", [
          "split-window",
          "-t", `${this.sessionName}:0`,
          "-h",
          "-P",
          "-F", "#{pane_id}",
          "-c", cwd,
          "sh", "-c", `cd ${this.shellEscape(cwd)} && ${pane.command}`,
        ]);
        const newPaneId = stdout.trim();
        this.paneMap.set(pane.name, newPaneId);
        paneIds.push(newPaneId);
      }

      // Apply tiled layout for even distribution
      try {
        await execFileAsync("tmux", [
          "select-layout", "-t", `${this.sessionName}:0`, "tiled",
        ]);
      } catch {
        // Ignore - might be single pane
      }
    }
  }

  /**
   * Kill all panes in window 0 (dashboard) except the first one
   * Returns the first pane ID for reuse
   */
  async clearDashboardPanes(): Promise<string | null> {
    const paneIds = await this.getWindow0PaneIds();
    if (paneIds.length === 0) return null;

    const firstPaneId = paneIds[0];

    // Kill all panes except the first one
    for (let i = paneIds.length - 1; i >= 1; i--) {
      try {
        await execFileAsync("tmux", ["kill-pane", "-t", paneIds[i]]);
      } catch {
        // Pane may already be gone
      }
    }

    // Clear paneMap entries for killed panes
    for (const [name, paneId] of this.paneMap.entries()) {
      if (paneIds.includes(paneId) && paneId !== firstPaneId) {
        this.paneMap.delete(name);
      }
    }

    return firstPaneId;
  }

  /**
   * Recreate dashboard layout (hot-reload safe)
   * Clears existing dashboard panes and creates new ones
   */
  async recreateDashboardLayout(dashboard: Dashboard, cwd: string): Promise<void> {
    await this.clearDashboardPanes();
    await this.createDashboardLayout(dashboard, cwd);
  }
}

