import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, unlinkSync } from "fs";
import {
  RESULT_PREFIX,
  getResultFilePath,
  buildInteractionEnv,
  type FormSchema,
} from "@mcp-ide/shared";
import { emitResultEvent } from "./events.js";

/**
 * Common interface for tmux managers (TmuxManager and EmbeddedTmuxManager)
 * Defines the methods needed by InteractionManager
 */
export interface TmuxPaneManager {
  createPane(
    name: string,
    command: string,
    cwd: string,
    env?: Record<string, string>,
    options?: { direction?: "auto" | "right" | "left" | "top" | "bottom"; skipRebalance?: boolean }
  ): Promise<string>;
  killPane(name: string): Promise<void>;
  paneExists(name: string): Promise<boolean>;
  capturePane(name: string, lines?: number): Promise<string>;
}

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Directory name for interactive component files (relative to project root)
 * Files passed to ink_file are resolved relative to this folder
 */
export const INTERACTIVE_DIR = ".mide/interactive";

export type InteractionMode = "schema" | "custom";
export type InteractionStatus = "pending" | "completed" | "cancelled" | "timeout";
export type InteractionAction = "accept" | "decline" | "cancel" | "timeout";

export interface InteractionResult {
  action: InteractionAction;
  answers?: Record<string, string | string[]>;
  result?: unknown;
}

export interface InteractionState {
  id: string;
  mode: InteractionMode;
  paneId: string;
  status: InteractionStatus;
  result?: InteractionResult;
  createdAt: Date;
  timeoutMs?: number;
}

export interface CreateInteractionOptions {
  schema?: FormSchema;
  inkFile?: string;  // Path to custom Ink component file
  inkArgs?: Record<string, unknown>;  // Args to pass to ink component
  command?: string;  // Arbitrary command to run
  title?: string;
  group?: string;
  timeoutMs?: number;
}

interface InteractionManagerOptions {
  tmuxManager: TmuxPaneManager;
  inkRunnerPath?: string;
  pollIntervalMs?: number;
  cwd?: string;  // Project root directory for resolving ink_file paths
  sessionName?: string;  // Tmux session name for events file
}

/**
 * Manages interactive form/component sessions in tmux panes
 */
export class InteractionManager extends EventEmitter {
  private interactions: Map<string, InteractionState> = new Map();
  private tmuxManager: TmuxPaneManager;
  private inkRunnerPath: string;
  private pollIntervalMs: number;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private idCounter = 0;
  private cwd: string;
  private sessionName: string | undefined;

  constructor(options: InteractionManagerOptions) {
    super();
    this.tmuxManager = options.tmuxManager;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.cwd = options.cwd ?? process.cwd();
    this.sessionName = options.sessionName;

    // Find runner path relative to this module
    this.inkRunnerPath = options.inkRunnerPath ?? this.findInkRunnerPath();
  }

  /**
   * Set the session name (for emitting events)
   */
  setSessionName(sessionName: string): void {
    this.sessionName = sessionName;
  }

  /**
   * Emit result to events file if session name is set
   */
  private emitResultToEventsFile(id: string, result: InteractionResult): void {
    if (this.sessionName) {
      emitResultEvent(
        this.sessionName,
        id,
        result.action,
        result.answers,
        result.result
      );
    }
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
   * 2. Project .mide/interactive/ (takes precedence)
   * 3. Global ~/.mide/interactive/
   */
  resolveInkFile(filePath: string): string {
    // Absolute paths used as-is
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // Try project-local .mide/interactive/ first
    const projectPath = path.join(this.getInteractiveDir(), filePath);
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }

    // Try global ~/.mide/interactive/
    const globalPath = path.join(os.homedir(), ".mide", "interactive", filePath);
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

    console.error(`[mide] Warning: ink-runner not found. Expected at: ${distPath}`);
    return distPath;
  }

  /**
   * Determine which runner to use based on options
   * - inkFile → ink-runner (React components)
   * - command → run command directly
   * - schema → ink-runner with schema (rendered as form)
   */
  private selectRunner(options: CreateInteractionOptions): "ink" | "command" {
    // Ink file specified → ink
    if (options.inkFile) {
      return "ink";
    }

    // Schema specified → ink (will be rendered as form)
    if (options.schema) {
      return "ink";
    }

    // Command → direct
    if (options.command) {
      return "command";
    }

    throw new Error("Must specify schema, inkFile, or command");
  }

  /**
   * Create a new interaction
   */
  async create(options: CreateInteractionOptions): Promise<string> {
    const id = `interaction-${++this.idCounter}-${Date.now()}`;

    if (!options.schema && !options.inkFile && !options.command) {
      throw new Error("Either schema, inkFile, or command is required");
    }

    // Determine which runner to use
    const runner = this.selectRunner(options);
    const mode: InteractionMode = runner === "ink" ? "custom" : "schema";

    // Build environment variables for the interaction
    const env = buildInteractionEnv(id);

    // Build the command based on runner type
    let command: string;
    const shellEscape = (s: string) => s.replace(/'/g, "'\\''");

    switch (runner) {
      case "ink": {
        // Use ink-runner for custom React components or schema-based forms
        if (options.inkFile) {
          const resolvedPath = this.resolveInkFile(options.inkFile);
          command = `node "${this.inkRunnerPath}" --file '${shellEscape(resolvedPath)}' --interaction-id '${id}'`;
        } else if (options.schema) {
          // Schema mode: pass schema to ink-runner (it has built-in form handling)
          const schemaJson = JSON.stringify(options.schema);
          command = `node "${this.inkRunnerPath}" --schema '${shellEscape(schemaJson)}' --interaction-id '${id}'`;
        } else {
          throw new Error("ink runner requires inkFile or schema");
        }
        if (options.title) {
          command += ` --title '${shellEscape(options.title)}'`;
        }
        if (options.inkArgs) {
          command += ` --args '${shellEscape(JSON.stringify(options.inkArgs))}'`;
        }
        break;
      }

      case "command": {
        // Run arbitrary command directly
        command = options.command!;
        break;
      }
    }

    // Create tmux pane for the interaction with env vars
    const paneId = await this.tmuxManager.createPane(
      id,
      command,
      process.cwd(),
      env
    );

    const state: InteractionState = {
      id,
      mode,
      paneId,
      status: "pending",
      createdAt: new Date(),
      timeoutMs: options.timeoutMs,
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

    // Clean up result file if exists
    try {
      const resultFilePath = getResultFilePath(id);
      if (existsSync(resultFilePath)) {
        unlinkSync(resultFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }

    // Kill the tmux pane (use interaction id as the "process name" since that's what we registered with)
    try {
      await this.tmuxManager.killPane(id);
    } catch {
      // Pane might already be gone
    }

    // Update state
    state.status = "cancelled";
    state.result = { action: "cancel" };
    this.emitResultToEventsFile(id, state.result);
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

    // Clean up result file if exists
    try {
      const resultFilePath = getResultFilePath(id);
      if (existsSync(resultFilePath)) {
        unlinkSync(resultFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }

    // Try to kill pane if it still exists (use interaction id as the "process name")
    try {
      await this.tmuxManager.killPane(id);
    } catch {
      // Pane might already be gone
    }

    this.interactions.delete(id);
  }

  /**
   * Start polling for result in tmux pane
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
          this.emitResultToEventsFile(id, state.result);
          this.emit("interactionComplete", id, state.result);
          return;
        }
      }

      // Check for result file FIRST (primary, more reliable method)
      // This must happen before pane check to handle edge case where pane is
      // forcibly removed but result file was already written
      const resultFilePath = getResultFilePath(id);
      const pendingFilePath = `${resultFilePath}.pending`;
      try {
        if (existsSync(resultFilePath)) {
          const fileContent = readFileSync(resultFilePath, "utf-8");
          const result = JSON.parse(fileContent) as InteractionResult;
          state.status = "completed";
          state.result = result;
          this.stopPolling(id);
          // Delete pending file to signal confirmation to ink-runner
          try { unlinkSync(pendingFilePath); } catch { /* ignore */ }
          // Clean up result file immediately
          try { unlinkSync(resultFilePath); } catch { /* ignore */ }
          // Clean up pane after small delay to allow output to be seen
          setTimeout(() => this.cleanup(id), 1000);
          this.emitResultToEventsFile(id, result);
          this.emit("interactionComplete", id, result);
          return;
        }
      } catch {
        // File read failed, continue with fallback
      }

      // Check if pane still exists (use interaction id as the "process name")
      const paneExists = await this.tmuxManager.paneExists(id);
      if (!paneExists) {
        // Pane was closed/died AND no result file = treat as cancel
        state.status = "cancelled";
        state.result = { action: "cancel" };
        this.stopPolling(id);
        this.interactions.delete(id);  // Remove from memory
        this.emitResultToEventsFile(id, state.result);
        this.emit("interactionComplete", id, state.result);
        return;
      }

      // Fallback: Capture pane output and look for result (use interaction id as "process name")
      try {
        const output = await this.tmuxManager.capturePane(id, 50);
        const result = this.parseResult(output);

        if (result) {
          state.status = "completed";
          state.result = result;
          this.stopPolling(id);
          // Clean up pane after small delay to allow output to be seen
          setTimeout(() => this.cleanup(id), 1000);
          this.emitResultToEventsFile(id, result);
          this.emit("interactionComplete", id, result);
          return;
        }
      } catch {
        // Pane might have been closed
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
   * Parse result from pane output
   */
  private parseResult(output: string): InteractionResult | null {
    const lines = output.split("\n");

    for (const line of lines) {
      const prefixIndex = line.indexOf(RESULT_PREFIX);
      if (prefixIndex !== -1) {
        const jsonStr = line.substring(prefixIndex + RESULT_PREFIX.length);
        try {
          return JSON.parse(jsonStr);
        } catch {
          // Invalid JSON, continue searching
        }
      }
    }

    return null;
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
