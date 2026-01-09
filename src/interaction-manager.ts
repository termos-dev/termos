import { EventEmitter } from "events";
import { TmuxManager } from "./tmux-manager.js";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, unlinkSync } from "fs";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Result prefix used by ink-runner to signal completion (stdout fallback)
 */
const RESULT_PREFIX = "__MCP_RESULT__:";

/**
 * File-based result communication (primary method)
 * More reliable than stdout since it's synchronous
 */
const RESULT_FILE_DIR = "/tmp";

function getResultFilePath(interactionId: string): string {
  return `${RESULT_FILE_DIR}/mcp-interaction-${interactionId}.result`;
}

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

export interface FormQuestion {
  question: string;
  header: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  inputType?: "text" | "textarea" | "password";
  placeholder?: string;
  validation?: string;
}

export interface FormSchema {
  questions: FormQuestion[];
}

export interface CreateInteractionOptions {
  schema?: FormSchema;
  inkFile?: string;  // Path to custom Ink component file
  title?: string;
  group?: string;
  timeoutMs?: number;
}

interface InteractionManagerOptions {
  tmuxManager: TmuxManager;
  inkRunnerPath?: string;
  pollIntervalMs?: number;
  cwd?: string;  // Project root directory for resolving ink_file paths
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

  constructor(options: InteractionManagerOptions) {
    super();
    this.tmuxManager = options.tmuxManager;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.cwd = options.cwd ?? process.cwd();

    // Find ink-runner path relative to this module
    // In production, it should be in ../packages/ink-runner/dist/index.js
    // or installed as a dependency
    this.inkRunnerPath = options.inkRunnerPath ?? this.findInkRunnerPath();
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
   * Create a new interaction
   */
  async create(options: CreateInteractionOptions): Promise<string> {
    const id = `interaction-${++this.idCounter}-${Date.now()}`;

    if (!options.schema && !options.inkFile) {
      throw new Error("Either schema or inkFile is required");
    }

    const mode: InteractionMode = options.schema ? "schema" : "custom";

    // Build the command to run ink-runner
    let command: string;
    const interactionIdArg = ` --interaction-id '${id}'`;  // For file-based result communication
    if (options.schema) {
      const schemaJson = JSON.stringify(options.schema);
      const escapedSchema = schemaJson.replace(/'/g, "'\\''"); // Escape single quotes for shell
      command = `node "${this.inkRunnerPath}" --schema '${escapedSchema}'${interactionIdArg}`;
      if (options.title) {
        const escapedTitle = options.title.replace(/'/g, "'\\''");
        command += ` --title '${escapedTitle}'`;
      }
    } else if (options.inkFile) {
      // Custom mode from file - saves tokens!
      // Resolve relative paths from .mide/interactive directory
      const resolvedPath = this.resolveInkFile(options.inkFile);
      const escapedPath = resolvedPath.replace(/'/g, "'\\''");
      command = `node "${this.inkRunnerPath}" --file '${escapedPath}'${interactionIdArg}`;
      if (options.title) {
        const escapedTitle = options.title.replace(/'/g, "'\\''");
        command += ` --title '${escapedTitle}'`;
      }
    } else {
      throw new Error("Either schema or inkFile is required");
    }

    // Create tmux pane for the interaction
    const paneId = await this.tmuxManager.createPane(
      id,
      command,
      process.cwd(),
      {}
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
