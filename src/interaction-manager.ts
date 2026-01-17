import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import {
  buildInteractionEnv,
  type FormSchema,
} from "@termosdev/shared";
import { findResultEvent } from "./events.js";
import { ensureEventsFile, getSessionRuntimeDir } from "./runtime.js";
import { type PaneHost, selectPaneHost, type PositionPreset } from "./pane-hosts.js";
import { shellEscape, loadShellTemplate, renderShellTemplate } from "./shell-utils.js";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Directory name for interactive component files (relative to project root)
 * Files passed to ink_file are resolved relative to this folder
 */
export const INTERACTIVE_DIR = ".termos/interactive";

export type InteractionStatus = "pending" | "completed" | "cancelled" | "timeout";
export type InteractionAction = "accept" | "decline" | "cancel" | "timeout";
export interface InteractionResult {
  action: InteractionAction;
  answers?: Record<string, string | string[]>;
  result?: unknown;
}

export interface InteractionState {
  id: string;
  paneId: string;
  status: InteractionStatus;
  result?: InteractionResult;
  createdAt: Date;
  timeoutMs?: number;
  ephemeral?: boolean;  // If true, kill pane when result detected
  pidFile?: string;
}

export interface CreateInteractionOptions {
  id?: string;
  component?: string;
  isCommand?: boolean;
  schema?: FormSchema;
  inkFile?: string;  // Path to custom Ink component file
  inkArgs?: Record<string, unknown>;  // Args to pass to ink component
  command?: string;  // Arbitrary command to run
  title?: string;
  timeoutMs?: number;
  position?: PositionPreset;  // Position preset (floating, split, tab, etc.)
  heightPercent?: number;     // Override height (percentage of terminal)
  closeOnExit?: boolean;      // Close pane when command exits (default: auto based on component type)
  wrapperTemplate?: string;   // Override wrapper template (default: "command-wrapper")
}

interface InteractionManagerOptions {
  inkRunnerPath?: string;
  pollIntervalMs?: number;
  cwd?: string;  // Project root directory for resolving ink_file paths
  sessionName?: string;
  host?: PaneHost;
}

/**
 * Manages interactive form/component sessions in pane hosts (Zellij or macOS Terminal)
 */
export class InteractionManager extends EventEmitter {
  private interactions: Map<string, InteractionState> = new Map();
  private inkRunnerPath: string;
  private pollIntervalMs: number;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private idCounter = 0;
  private cwd: string;
  private host: PaneHost;
  private sessionName: string;

  constructor(options: InteractionManagerOptions) {
    super();
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.cwd = options.cwd ?? process.cwd();
    this.host = options.host ?? selectPaneHost(this.cwd);
    this.sessionName = this.host.sessionName;

    // Find runner path relative to this module
    this.inkRunnerPath = options.inkRunnerPath ?? this.findInkRunnerPath();
  }

  generateId(): string {
    return `interaction-${++this.idCounter}-${Date.now()}`;
  }

  /**
   * Set the config directory (for events file)
   */
  setSessionName(sessionName: string): void {
    this.sessionName = sessionName;
  }

  /**
   * Get the events file path
   */
  private getEventsFile(): string {
    return ensureEventsFile(this.sessionName);
  }

  /**
   * Get the interactive components directory path
   */
  getInteractiveDir(): string {
    return path.join(this.cwd, INTERACTIVE_DIR);
  }

  getSessionName(): string {
    return this.sessionName;
  }

  /**
   * Resolve an ink_file path
   * Resolution order:
   * 1. Absolute paths used as-is
   * 2. Project .termos/interactive/ (user override)
   * 3. Global ~/.termos/interactive/ (user global)
   * 4. ink-runner bundled components
   */
  resolveInkFile(filePath: string): string {
    // Absolute paths used as-is
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // Handle paths that already include .termos/interactive/ prefix
    // This allows both "select.tsx" and ".termos/interactive/select.tsx" to work
    let normalizedPath = filePath;
    const interactivePrefix = INTERACTIVE_DIR + "/";
    if (filePath.startsWith(interactivePrefix)) {
      normalizedPath = filePath.slice(interactivePrefix.length);
    }

    // Try project-local .termos/interactive/ first
    const projectPath = path.join(this.getInteractiveDir(), normalizedPath);
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }

    // Try CWD-relative path (for .termos/interactive/foo.tsx style paths)
    const cwdRelative = path.join(this.cwd, filePath);
    if (fs.existsSync(cwdRelative)) {
      return cwdRelative;
    }

    // Try global ~/.termos/interactive/
    const globalPath = path.join(os.homedir(), ".termos", "interactive", normalizedPath);
    if (fs.existsSync(globalPath)) {
      return globalPath;
    }

    // Try ink-runner bundled components (dist/ink-runner/components/)
    const inkRunnerPath = path.join(__dirname, "ink-runner", "components", normalizedPath);
    if (fs.existsSync(inkRunnerPath)) {
      return inkRunnerPath;
    }

    // Fallback to project path (will error if not found)
    return projectPath;
  }

  private findInkRunnerPath(): string {
    // ink-runner is copied to dist/ink-runner/ during build
    // __dirname is dist/ so ink-runner is at dist/ink-runner/dist/index.js
    const distPath = path.join(__dirname, "ink-runner", "dist", "index.js");

    if (fs.existsSync(distPath)) {
      return distPath;
    }

    // Fallback for development: try the packages folder
    const devPath = path.join(__dirname, "..", "packages", "ink-runner", "dist", "index.js");
    if (fs.existsSync(devPath)) {
      return devPath;
    }

    // Last resort: try cwd-relative path
    const cwdPath = path.join(process.cwd(), "packages", "ink-runner", "dist", "index.js");
    if (fs.existsSync(cwdPath)) {
      return cwdPath;
    }

    console.error(`[termos] Warning: ink-runner not found. Expected at: ${distPath}`);
    return distPath;
  }

  /**
   * Create a new interaction
   */
  async create(options: CreateInteractionOptions): Promise<string> {
    const id = options.id ?? this.generateId();
    const eventsFile = this.getEventsFile();
    const pidFile = path.join(getSessionRuntimeDir(this.sessionName), `pid-${id}.txt`);
    const env: Record<string, string> = {
      ...buildInteractionEnv(id, eventsFile),
      TERMOS_PID_FILE: pidFile,
    };
    const nodeBin = process.env.TERMOS_NODE || process.execPath || "node";
    const nodeCmd = shellEscape(nodeBin);
    const pidPrefix = 'if [ -n "$TERMOS_PID_FILE" ]; then echo $$ > "$TERMOS_PID_FILE"; fi';
    const useExec = this.host.kind === "zellij";

    let command: string;
    const sanitizeTitle = (value: string): string => value.replace(/[\r\n\t]+/g, " ").trim();
    const truncateTitle = (value: string, max = 48): string => {
      if (value.length <= max) return value;
      return `${value.slice(0, Math.max(0, max - 3))}...`;
    };
    const getPaneName = (): string => {
      const optionTitle = typeof options.title === "string" ? sanitizeTitle(options.title) : "";
      if (optionTitle) return truncateTitle(optionTitle);
      const argTitle = typeof options.inkArgs?.title === "string" ? sanitizeTitle(options.inkArgs.title) : "";
      if (argTitle) return truncateTitle(argTitle);
      const promptTitle = typeof options.inkArgs?.prompt === "string" ? sanitizeTitle(options.inkArgs.prompt) : "";
      if (promptTitle) return truncateTitle(promptTitle);
      const fileTitle = typeof options.inkArgs?.file === "string"
        ? sanitizeTitle(path.basename(options.inkArgs.file))
        : "";
      if (fileTitle) return truncateTitle(fileTitle);
      if (options.component) return truncateTitle(options.component);
      if (options.command) return "command";
      return id;
    };

    if (options.inkFile) {
      const resolvedPath = this.resolveInkFile(options.inkFile);
      const execPrefix = useExec ? "exec " : "";
      // shellEscape already wraps in single quotes, so no extra quotes needed
      command = `${pidPrefix}; ${execPrefix}${nodeCmd} "${this.inkRunnerPath}" --file ${shellEscape(resolvedPath)}`;
      if (options.title) command += ` --title ${shellEscape(options.title)}`;
      if (options.inkArgs) command += ` --args ${shellEscape(JSON.stringify(options.inkArgs))}`;
    } else if (options.schema) {
      const execPrefix = useExec ? "exec " : "";
      // shellEscape already wraps in single quotes, so no extra quotes needed
      command = `${pidPrefix}; ${execPrefix}${nodeCmd} "${this.inkRunnerPath}" --schema ${shellEscape(JSON.stringify(options.schema))}`;
      if (options.title) command += ` --title ${shellEscape(options.title)}`;
    } else if (options.command) {
      // Wrap command using shell template
      const templateName = options.wrapperTemplate ?? "command-wrapper";
      const template = loadShellTemplate(templateName);
      command = renderShellTemplate(template, {
        PID_PREFIX: pidPrefix,
        EVENTS_FILE: shellEscape(eventsFile),
        ID: shellEscape(id),
        COMMAND: options.command,
      });
    } else {
      throw new Error("Either schema, inkFile, or command is required");
    }

    // Ephemeral: ink components and schema forms auto-close when done
    // Persistent: shell commands (-- <cmd>) stay visible for output review
    // Can be overridden with explicit closeOnExit option
    const ephemeral = options.closeOnExit ?? !!(options.inkFile || options.schema);

    const paneName = getPaneName();
    await this.host.run(
      command,
      {
        name: paneName,
        cwd: this.cwd,
        position: options.position ?? "floating",
        closeOnExit: ephemeral,
        heightPercent: options.heightPercent,
      },
      env
    );

    const state: InteractionState = {
      id,
      paneId: id,
      status: "pending",
      createdAt: new Date(),
      timeoutMs: options.timeoutMs,
      ephemeral,
      pidFile,
    };

    this.interactions.set(id, state);

    // Start polling for result
    this.startPolling(id);

    return id;
  }

  /**
   * Get the current state of an interaction
   */
  getState(id: string): InteractionState | undefined {
    return this.interactions.get(id);
  }

  /**
   * Wait for an interaction to complete
   * @param id Interaction ID
   * @param timeoutMs Max time to wait (0 = no timeout, just check status)
   * @returns Result if complete, undefined if still pending
   */
  async waitForResult(id: string, timeoutMs: number = 0): Promise<InteractionResult | undefined> {
    const state = this.interactions.get(id);
    if (!state) {
      throw new Error(`Interaction "${id}" not found`);
    }

    // If already complete, return result
    if (state.status !== "pending") {
      return state.result;
    }

    // If no timeout, just return undefined (caller should poll)
    if (timeoutMs <= 0) {
      return undefined;
    }

    // Wait for result with timeout
    return new Promise<InteractionResult | undefined>((resolve) => {
      const startTime = Date.now();

      const checkResult = () => {
        const currentState = this.interactions.get(id);
        if (!currentState) {
          resolve(undefined);
          return;
        }

        if (currentState.status !== "pending") {
          resolve(currentState.result);
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          resolve(undefined);
          return;
        }

        // Keep checking
        setTimeout(checkResult, Math.min(this.pollIntervalMs, timeoutMs - elapsed));
      };

      checkResult();
    });
  }

  /**
   * Cancel an interaction
   */
  async cancel(id: string): Promise<boolean> {
    const state = this.interactions.get(id);
    if (!state) {
      return false;
    }

    if (state.status !== "pending") {
      return false;
    }

    if (state.pidFile) {
      try {
        const pidRaw = fs.readFileSync(state.pidFile, "utf-8").trim();
        const pid = Number(pidRaw);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // Ignore if process already exited
          }
        }
      } catch {
        // Ignore pid lookup errors
      }
    }

    if (this.host.close) {
      try {
        await this.host.close(state.paneId);
      } catch {
        // Ignore close errors
      }
    }

    // Stop polling and update state
    this.stopPolling(id);
    state.status = "cancelled";
    state.result = { action: "cancel" };
    await this.cleanup(id);
    this.emit("interactionComplete", id, state.result);

    return true;
  }

  /**
   * Clean up a completed interaction
   */
  async cleanup(id: string): Promise<void> {
    const state = this.interactions.get(id);
    if (!state) {
      return;
    }

    this.stopPolling(id);
    if (state.ephemeral && this.host.close) {
      try {
        await this.host.close(state.paneId);
      } catch {
        // Ignore close errors
      }
    }
    if (state.pidFile) {
      try {
        fs.unlinkSync(state.pidFile);
      } catch {
        // Ignore
      }
    }

    this.interactions.delete(id);
  }

  /**
   * Start polling for result in events file
   */
  private startPolling(id: string): void {
    const poll = async () => {
      const state = this.interactions.get(id);
      if (!state || state.status !== "pending") {
        this.stopPolling(id);
        return;
      }

      // Check for timeout
      if (state.timeoutMs) {
        const elapsed = Date.now() - state.createdAt.getTime();
        if (elapsed >= state.timeoutMs) {
          state.status = "timeout";
          state.result = { action: "timeout" };
          this.stopPolling(id);
          await this.cleanup(id);
          this.emit("interactionComplete", id, state.result);
          return;
        }
      }

      // Check for result in events file
      const resultEvent = findResultEvent(this.sessionName, id);
      if (resultEvent) {
        state.status = "completed";
        state.result = {
          action: resultEvent.action,
          answers: resultEvent.answers,
          result: resultEvent.result,
        };
        this.stopPolling(id);
        await this.cleanup(id);
        this.emit("interactionComplete", id, state.result);
        return;
      }

      // Schedule next poll
      const timer = setTimeout(poll, this.pollIntervalMs);
      this.pollTimers.set(id, timer);
    };

    poll();
  }

  /**
   * Stop polling for an interaction
   */
  private stopPolling(id: string): void {
    const timer = this.pollTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.pollTimers.delete(id);
    }
  }

  /**
   * Stop all interactions and clean up
   */
  async stopAll(): Promise<void> {
    for (const [id] of this.interactions) {
      await this.cancel(id);
    }
  }
}
