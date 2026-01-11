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
import { getEventsFilePath } from "./tmux-manager.js";
import type { TmuxManager } from "./tmux-manager.js";

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
}

export interface CreateInteractionOptions {
  schema?: FormSchema;
  inkFile?: string;  // Path to custom Ink component file
  inkArgs?: Record<string, unknown>;  // Args to pass to ink component
  command?: string;  // Arbitrary command to run
  title?: string;
  timeoutMs?: number;
}

interface InteractionManagerOptions {
  tmuxManager: TmuxManager;
  inkRunnerPath?: string;
  pollIntervalMs?: number;
  cwd?: string;  // Project root directory for resolving ink_file paths
  configDir?: string;  // Config directory for events file
}

/**
 * Manages interactive form/component sessions in tmux panes
 */
export class InteractionManager extends EventEmitter {
  private interactions: Map<string, InteractionState> = new Map();
  private tmuxManager: TmuxManager;
  private inkRunnerPath: string;
  private pollIntervalMs: number;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private idCounter = 0;
  private cwd: string;
  private configDir: string;

  constructor(options: InteractionManagerOptions) {
    super();
    this.tmuxManager = options.tmuxManager;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.cwd = options.cwd ?? process.cwd();
    this.configDir = options.configDir ?? process.cwd();

    // Find runner path relative to this module
    this.inkRunnerPath = options.inkRunnerPath ?? this.findInkRunnerPath();
  }

  /**
   * Set the config directory (for events file)
   */
  setConfigDir(configDir: string): void {
    this.configDir = configDir;
  }

  /**
   * Get the events file path
   */
  private getEventsFile(): string {
    return getEventsFilePath(this.configDir);
  }

  /**
   * Get the interactive components directory path
   */
  getInteractiveDir(): string {
    return path.join(this.cwd, INTERACTIVE_DIR);
  }

  /**
   * Resolve an ink_file path
   * Resolution order:
   * 1. Absolute paths used as-is
   * 2. Project .termos/interactive/ (takes precedence)
   * 3. Global ~/.termos/interactive/
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
    const id = `interaction-${++this.idCounter}-${Date.now()}`;
    const eventsFile = this.getEventsFile();
    const env = buildInteractionEnv(id, eventsFile);
    const shellEscape = (s: string) => s.replace(/'/g, "'\\''");

    let command: string;

    if (options.inkFile) {
      const resolvedPath = this.resolveInkFile(options.inkFile);
      command = `node "${this.inkRunnerPath}" --file '${shellEscape(resolvedPath)}'`;
      if (options.title) command += ` --title '${shellEscape(options.title)}'`;
      if (options.inkArgs) command += ` --args '${shellEscape(JSON.stringify(options.inkArgs))}'`;
    } else if (options.schema) {
      command = `node "${this.inkRunnerPath}" --schema '${shellEscape(JSON.stringify(options.schema))}'`;
      if (options.title) command += ` --title '${shellEscape(options.title)}'`;
    } else if (options.command) {
      // Wrap command to write result to events file on exit
      command = `${options.command}; code=$?; ` +
        `if [ $code -eq 0 ]; then action=accept; else action=decline; fi; ` +
        `echo '{"ts":'$(date +%s000)',"type":"result","id":"${id}","action":"'$action'","result":{"exitCode":'$code'}}' >> "${eventsFile}"`;
    } else {
      throw new Error("Either schema, inkFile, or command is required");
    }

    // Smart default: .termos/interactive/* and schema forms are ephemeral
    // Shell commands are persistent (user may want to see output)
    const isInteractiveComponent = options.inkFile?.includes('.termos/interactive/') ||
                                   options.inkFile?.includes('.termos\\interactive\\');
    const ephemeral = !!(isInteractiveComponent || options.schema);

    const paneId = await this.tmuxManager.createPane(id, command, process.cwd(), env, {
      targetWindow: 0,  // Show in Canvas
    });

    const state: InteractionState = {
      id,
      paneId,
      status: "pending",
      createdAt: new Date(),
      timeoutMs: options.timeoutMs,
      ephemeral,  // Store for cleanup decision
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

    // Stop polling
    this.stopPolling(id);

    // Kill the tmux pane
    try {
      await this.tmuxManager.killPane(id);
    } catch {
      // Pane might already be gone
    }

    // Update state
    state.status = "cancelled";
    state.result = { action: "cancel" };
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

    // Try to kill pane if it still exists
    try {
      await this.tmuxManager.killPane(id);
    } catch {
      // Pane might already be gone
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
      const resultEvent = findResultEvent(this.configDir, id);
      if (resultEvent) {
        state.status = "completed";
        state.result = {
          action: resultEvent.action,
          answers: resultEvent.answers,
          result: resultEvent.result,
        };
        this.stopPolling(id);
        // Kill pane if ephemeral, otherwise leave it visible (dead but readable)
        if (state.ephemeral) {
          await this.cleanup(id);
        } else {
          this.interactions.delete(id);
        }
        this.emit("interactionComplete", id, state.result);
        return;
      }

      // Check if pane still exists
      const paneExists = await this.tmuxManager.paneExists(id);
      if (!paneExists) {
        // Pane was closed/died without result = treat as cancel
        state.status = "cancelled";
        state.result = { action: "cancel" };
        this.stopPolling(id);
        this.interactions.delete(id);
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
