import { execFileSync, spawnSync } from "child_process";
import * as net from "net";
import { LogBuffer } from "./log-buffer.js";
import { HealthChecker, HealthCheckOptions } from "./health-checker.js";
import { ResolvedProcessConfig } from "./config.js";
import { resolveCommand, resolveEnv, loadEnvFile, EnvContext, tryResolveEnvString } from "./env-resolver.js";
import { TmuxManager } from "./tmux-manager.js";

/**
 * Find the PID of a process using a specific port
 * Returns undefined if no process is using the port
 * Cross-platform: supports macOS, Linux, and Windows
 */
export function findPortUser(port: number): number | undefined {
  try {
    if (process.platform === "win32") {
      // Windows: use netstat with powershell for safer parsing
      // Using spawnSync with shell:false for safety - port is validated as number
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`
      ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

      if (result.status === 0 && result.stdout) {
        const pid = parseInt(result.stdout.trim(), 10);
        return Number.isFinite(pid) && pid > 0 ? pid : undefined;
      }
      return undefined;
    } else {
      // Unix (macOS, Linux): use lsof
      const result = execFileSync("lsof", ["-i", `:${port}`, "-t"], { encoding: "utf-8" });
      const pid = parseInt(result.trim().split("\n")[0], 10);
      return Number.isFinite(pid) ? pid : undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Kill a process by PID
 * Returns true if the process was killed, false otherwise
 */
export async function killProcess(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
    // Give it a moment to terminate with non-blocking delays
    for (let attempts = 0; attempts < 10; attempts++) {
      try {
        process.kill(pid, 0); // Check if still alive
        // Non-blocking delay
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        return true; // Process is gone
      }
    }
    // Force kill if still alive
    try {
      process.kill(pid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export type ProcessStatus = "pending" | "starting" | "ready" | "running" | "crashed" | "stopped" | "completed";

export interface StartOptions {
  args?: string;
  env?: Record<string, string>;
  force?: boolean; // Kill any process using the configured port before starting
  adoptExisting?: boolean; // When port is in use, adopt the existing process instead of failing
}

/**
 * Configurable settings for process management
 */
export interface ProcessSettings {
  logBufferSize: number;
  healthCheckInterval: number;
  restartBackoffMax: number;
  processStopTimeout: number;
}

// Default settings
export const DEFAULT_PROCESS_SETTINGS: ProcessSettings = {
  logBufferSize: 1000,
  healthCheckInterval: 10000,
  restartBackoffMax: 30000,
  processStopTimeout: 5000,
};

/**
 * Simple async lock to prevent race conditions in state transitions
 */
class StateLock {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Validate and sanitize command arguments
 * Prevents command injection by checking for dangerous patterns
 */
function validateCommandArgs(args: string): string {
  // Check for command chaining/injection patterns
  const dangerousPatterns = [
    /[;&|`$]/, // Shell operators and command substitution
    /\$\(/, // Command substitution
    />\s*\//, // Redirect to absolute path
    /\|\s*\w/, // Pipe to command
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(args)) {
      throw new Error(
        `Invalid command arguments: potential command injection detected. ` +
        `Arguments cannot contain shell operators (;, &, |, \`, $, etc.)`
      );
    }
  }

  // Return sanitized args (trim whitespace)
  return args.trim();
}

/**
 * Validate a regex pattern for safety (prevents ReDoS)
 * Checks for common problematic patterns and enforces complexity limits
 */
function validateRegexPattern(pattern: string, key: string): void {
  // Check pattern length
  if (pattern.length > 500) {
    throw new Error(`Regex pattern for "${key}" is too long (max 500 characters)`);
  }

  // Check for nested quantifiers which can cause exponential backtracking
  // e.g., (a+)+, (a*)*b, (a|b|c)*d
  const nestedQuantifiers = /\([^)]*[+*][^)]*\)[+*]|\([^)]*\|[^)]*\)[+*]/;
  if (nestedQuantifiers.test(pattern)) {
    throw new Error(`Regex pattern for "${key}" contains potentially dangerous nested quantifiers`);
  }

  // Try to compile and test with a timeout-like approach
  try {
    const regex = new RegExp(pattern);
    // Test against a reasonably long string to detect slow patterns
    const testString = "a".repeat(100);
    const start = Date.now();
    regex.test(testString);
    if (Date.now() - start > 50) {
      throw new Error(`Regex pattern for "${key}" is too slow`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("too slow")) {
      throw err;
    }
    throw new Error(`Invalid regex pattern for "${key}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Common patterns for detecting ports from framework output
const PORT_PATTERNS = [
  // Vite: "Local:   http://localhost:5173/"
  /Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
  // Next.js: "- Local: http://localhost:3000"
  /-\s*Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
  // Generic: "listening on port 3000" or "listening at port 3000"
  /listening\s+(?:on|at)\s+(?:port\s+)?(\d+)/i,
  // Generic: "server running on port 3000"
  /(?:server|app)\s+(?:is\s+)?running\s+(?:on|at)\s+(?:port\s+)?(\d+)/i,
  // Generic: "started on http://localhost:3000"
  /started\s+(?:on|at)\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
  // Generic: "http://localhost:3000"
  /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i,
  // Generic: "Port: 3000" or "port 3000"
  /\bport[:\s]+(\d+)/i,
  // Uvicorn: "Uvicorn running on http://127.0.0.1:8000"
  /running\s+on\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
  // Rails: "Listening on tcp://0.0.0.0:3000"
  /listening\s+on\s+tcp:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
  // Express/Node: "Express server listening on 3000"
  /listening\s+on\s+(\d+)/i,
];

export interface ProcessState {
  name: string;
  status: ProcessStatus;
  pid?: number;
  port?: number;
  url?: string;
  restartCount: number;
  lastRestartTime?: Date;
  healthy?: boolean;
  exitCode?: number;
  error?: string;
}

export interface ProcessEvents {
  onReady?: (process: ManagedProcess) => void;
  onCrash?: (process: ManagedProcess, exitCode: number | null) => void;
  onLog?: (process: ManagedProcess, line: string, stream: "stdout" | "stderr") => void;
  onHealthChange?: (process: ManagedProcess, healthy: boolean) => void;
}

/**
 * A managed background process
 */
export class ManagedProcess {
  readonly name: string;
  readonly config: ResolvedProcessConfig;
  readonly configDir: string;

  // Tmux-based process management
  private tmuxManager: TmuxManager;
  private paneId: string | null = null;
  private lastCapturedOutput = ""; // Track what we've already processed

  private combined: LogBuffer;
  private healthChecker: HealthChecker | null = null;
  private healthCheckTarget?: HealthCheckOptions;
  private portDetected = false;
  private portVerified = false;
  private portVerificationInProgress = false;
  private stdoutVarPatterns = new Map<string, RegExp>();
  private readyVars: string[] | null = null;

  private _status: ProcessStatus = "pending";
  private _port?: number;
  private _url?: string;
  private _exports: Record<string, string> = {};
  private _ready = false;
  private _restartCount = 0;
  private _lastRestartTime?: Date;
  private _healthy?: boolean;
  private _exitCode?: number;
  private _error?: string;

  private events: ProcessEvents;
  private envContext?: EnvContext;
  private settings: ProcessSettings;

  // State lock to prevent race conditions in state transitions
  private stateLock = new StateLock();
  // Sequence number to track state changes and abort stale operations
  private stateSequence = 0;

  constructor(
    config: ResolvedProcessConfig,
    configDir: string,
    events: ProcessEvents = {},
    settings: ProcessSettings = DEFAULT_PROCESS_SETTINGS,
    tmuxManager: TmuxManager
  ) {
    this.name = config.name;
    this.config = config;
    this.configDir = configDir;
    this.events = events;
    this.settings = settings;
    this.tmuxManager = tmuxManager;

    this.combined = new LogBuffer(settings.logBufferSize);

    if (config.stdoutPatternVars) {
      for (const [key, pattern] of Object.entries(config.stdoutPatternVars)) {
        // Validate regex for safety (prevents ReDoS attacks)
        validateRegexPattern(pattern, key);
        this.stdoutVarPatterns.set(key, new RegExp(pattern));
      }
    }

    this.readyVars = this.getReadyVars();

    // If fixed port is configured, set the internal port but NOT the export
    // The export will be set after TCP verification confirms the port is listening
    if (config.port) {
      this._port = config.port;
    }
  }

  /**
   * Set the env context for variable interpolation
   */
  setEnvContext(envContext: EnvContext): void {
    this.envContext = envContext;
    this.syncExportsMap();
    this.syncPortMap();
  }

  /**
   * Attach to an already-running tmux pane (for CLI tools querying status)
   * Sets paneId and marks status as running
   */
  attachToExistingPane(paneId: string): void {
    this.paneId = paneId;
    this._status = "running";
  }

  /**
   * Start the process
   */
  async start(options: StartOptions = {}): Promise<void> {
    if (this.isRunning()) {
      throw new Error(`Process "${this.name}" is already running`);
    }

    if (!this.envContext) {
      throw new Error(`Environment context not set for process "${this.name}"`);
    }

    // Check for port conflicts if we have a configured port
    if (this.config.port) {
      const conflictPid = findPortUser(this.config.port);
      if (conflictPid) {
        const shouldForce = options.force ?? this.config.force;

        if (shouldForce) {
          console.error(`[termos] Port ${this.config.port} in use by PID ${conflictPid}, force-killing...`);
          if (await killProcess(conflictPid)) {
            console.error(`[termos] Killed PID ${conflictPid}`);
          } else {
            throw new Error(`Failed to kill process ${conflictPid} using port ${this.config.port}`);
          }
        } else {
          throw new Error(`Port ${this.config.port} is already in use by PID ${conflictPid}. Use force=true to kill it.`);
        }
      }
    }

    this.resetRuntimeState();
    this._status = "starting";
    this._error = undefined;
    this._exitCode = undefined;

    // Build environment variables
    const processEnv = this.buildEnvironment(options);

    // Resolve command
    const resolvedCommand = resolveCommand(this.config.command, this.envContext);

    // Validate and resolve extra arguments if provided
    let fullCommand = resolvedCommand;
    if (options.args) {
      const validatedArgs = validateCommandArgs(options.args);
      const resolvedArgs = resolveCommand(validatedArgs, this.envContext);
      fullCommand = `${resolvedCommand} ${resolvedArgs}`;
    }

    // Create service window (tab) and run command in tmux
    // Services run in separate windows for better organization
    this.paneId = await this.tmuxManager.createServiceWindow(
      this.name,
      fullCommand,
      this.config.resolvedCwd,
      processEnv
    );

    this.lastCapturedOutput = "";
    console.error(`[termos] Started "${this.name}" in tmux window (pane ${this.paneId})`);

    // Mark as running immediately (port detection happens async)
    this._status = "running";
    this.maybeStartHealthChecker();
    this.maybeStartPortVerification();
    this.maybeUpdateReadiness();
  }

  /**
   * Build environment variables for the process
   */
  private buildEnvironment(options: StartOptions): Record<string, string> {
    const processEnv: Record<string, string> = {};

    // Copy relevant system env vars
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        processEnv[key] = value;
      }
    }

    // Load envFile if specified (before other env vars so they can override)
    if (this.config.envFile) {
      try {
        const envFileVars = loadEnvFile(this.config.envFile, this.configDir);
        Object.assign(processEnv, envFileVars);
      } catch (err) {
        throw new Error(`Failed to load envFile for process "${this.name}": ${err}`);
      }
    }

    // Add PORT if allocated
    if (this._port !== undefined) {
      processEnv.PORT = String(this._port);
    }

    // Resolve and add custom env vars (these override envFile values)
    const mergedEnv = {
      ...(this.config.env ?? {}),
      ...(options.env ?? {}),
    };
    const resolvedEnv = resolveEnv(mergedEnv, this.envContext!);
    Object.assign(processEnv, resolvedEnv);

    return processEnv;
  }

  /**
   * Handle process exit (when detected from tmux poll)
   */
  private handleProcessExit(code: number | null): void {
    this._exitCode = code ?? undefined;
    this._ready = false;

    if (this._status !== "stopped") {
      const exitedSuccessfully = code === 0;

      // For restartPolicy: never, successful exit means "completed" (ready for dependents)
      if (this.config.restartPolicy === "never" && exitedSuccessfully) {
        this._status = "completed";
        this._ready = true;
        this.events.onReady?.(this);  // Signal ready for dependents
      } else if (exitedSuccessfully && this.config.restartPolicy === "onFailure") {
        // For onFailure policy, successful exit is just "stopped", not a crash
        this._status = "stopped";
      } else {
        // Crashed or needs restart
        this._status = "crashed";
        this._error = `Exited with code ${code}`;
        this.events.onCrash?.(this, code);
      }
    }

    this.stopHealthChecker();
  }

  /**
   * Check if process is currently running
   */
  isRunning(): boolean {
    return this.paneId !== null && this._status !== "crashed" && this._status !== "stopped" && this._status !== "completed";
  }

  /**
   * Check if using tmux mode (always true now)
   */
  get usesTmux(): boolean {
    return true;
  }

  /**
   * Poll and update status from tmux pane (called by ProcessManager)
   * Returns true if the process is still running, false if it exited
   */
  async pollTmuxStatus(): Promise<boolean> {
    if (!this.paneId) {
      return false;
    }

    // Get pane status
    const paneStatus = await this.tmuxManager.getPaneStatus(this.name);

    if (!paneStatus) {
      // Pane was deleted externally
      this._status = "crashed";
      this._error = "Pane was closed externally";
      this.paneId = null;
      this.events.onCrash?.(this, null);
      return false;
    }

    // Capture and process new output for port detection
    await this.captureTmuxOutput();

    if (paneStatus.isDead) {
      // Process exited
      this.handleProcessExit(paneStatus.exitStatus ?? null);
      return false;
    }

    return true;
  }

  /**
   * Capture tmux pane output and process for port/variable detection
   */
  private async captureTmuxOutput(): Promise<void> {
    const output = await this.tmuxManager.capturePane(this.name, 500);
    if (!output) return;

    // Find new lines by comparing with last capture
    // This is a simple approach - we look for new content at the end
    let newContent = output;
    if (this.lastCapturedOutput && output.includes(this.lastCapturedOutput.slice(-200))) {
      // Find where the new content starts
      const lastChunk = this.lastCapturedOutput.slice(-200);
      const idx = output.lastIndexOf(lastChunk);
      if (idx >= 0) {
        newContent = output.slice(idx + lastChunk.length);
      }
    }

    this.lastCapturedOutput = output;

    // Process new lines for port/variable detection
    if (newContent.trim()) {
      this.combined.pushLines(newContent);
      for (const line of newContent.split("\n")) {
        if (line.trim()) {
          this.handleLogLine(line, "stdout"); // tmux combines stdout/stderr
        }
      }
    }
  }

  /**
   * Handle a single log line
   */
  private handleLogLine(line: string, stream: "stdout" | "stderr"): void {
    this.events.onLog?.(this, line, stream);

    const updated = this.captureExports(line) || this.detectPort(line);
    if (updated) {
      this.maybeStartHealthChecker();
      this.maybeStartPortVerification();
      this.maybeUpdateReadiness();
    }
  }

  /**
   * Extract variables from stdout/stderr
   */
  private captureExports(line: string): boolean {
    if (this.stdoutVarPatterns.size === 0) {
      return false;
    }

    let updated = false;
    for (const [key, pattern] of this.stdoutVarPatterns) {
      const match = line.match(pattern);
      if (!match || !match[1]) {
        continue;
      }

      const value = match[1].trim();
      if (this.setExportVar(key, value)) {
        updated = true;
      }
    }

    return updated;
  }

  private setExportVar(key: string, value: string): boolean {
    if (key === "port") {
      return this.setPortFromString(value);
    }

    if (key === "url") {
      return this.setUrlValue(value);
    }

    if (this._exports[key] === value) {
      return false;
    }

    this._exports[key] = value;
    this.syncExportsMap();
    return true;
  }

  private setPortFromString(value: string): boolean {
    const port = parseInt(value, 10);
    if (!Number.isFinite(port) || port <= 0 || port >= 65536) {
      return false;
    }

    let updated = false;
    if (!this.config.port && this._port !== port) {
      this._port = port;
      updated = true;
    }

    // Don't set export immediately - let port verification handle it
    // This ensures the port is actually listening before marking ready
    this.portDetected = true;

    if (updated) {
      this.syncPortMap();
    }

    return updated;
  }

  private setUrlValue(value: string): boolean {
    let updated = false;

    if (this._url !== value) {
      this._url = value;
      updated = true;
    }

    if (this._exports.url !== value) {
      this._exports.url = value;
      updated = true;
    }

    if (updated) {
      this.syncExportsMap();
    }

    try {
      const parsed = new URL(value);
      if (parsed.port) {
        updated = this.setPortFromString(parsed.port) || updated;
      }
    } catch {
      // Ignore invalid URLs
    }

    return updated;
  }

  /**
   * Detect port from log output (fallback patterns)
   */
  private detectPort(line: string): boolean {
    if (this.stdoutVarPatterns.has("port")) {
      return false;
    }

    // Skip if port already set (either from config or already detected)
    if (this._port && this.portDetected) {
      return false;
    }

    // Try each pattern
    for (const pattern of PORT_PATTERNS) {
      const match = line.match(pattern);
      if (match && match[1]) {
        return this.setPortFromString(match[1]);
      }
    }

    return false;
  }

  private getReadyVars(): string[] | null {
    if (this.config.readyVars && this.config.readyVars.length > 0) {
      return this.config.readyVars;
    }

    if (this.config.stdoutPatternVars?.url) {
      return ["url"];
    }

    if (this.config.stdoutPatternVars?.port || this.config.port) {
      return ["port"];
    }

    return null;
  }

  private markReady(): void {
    if (this._ready) {
      return;
    }

    this._ready = true;
    this._status = "ready";
    this.events.onReady?.(this);
  }

  private maybeUpdateReadiness(): void {
    if (this._ready || this._status === "completed") {
      return;
    }

    if (this.config.restartPolicy === "never") {
      return;
    }

    if (this.config.healthCheck) {
      if (this._healthy === true) {
        this.markReady();
      }
      return;
    }

    if (this.readyVars && this.readyVars.length > 0) {
      const ready = this.readyVars.every((key) => Boolean(this._exports[key]));
      if (ready) {
        this.markReady();
      }
      return;
    }

    if (this._status === "running") {
      this.markReady();
    }
  }

  private resolveHealthCheckTarget(): HealthCheckOptions | null {
    if (!this.config.healthCheck || !this.envContext) {
      return null;
    }

    const resolved = tryResolveEnvString(this.config.healthCheck, this.envContext);
    if (!resolved) {
      return null;
    }

    if (/^https?:\/\//i.test(resolved)) {
      return { url: resolved };
    }

    if (!this._port) {
      return null;
    }

    const path = resolved.startsWith("/") ? resolved : `/${resolved}`;
    return { path, port: this._port };
  }

  private maybeStartHealthChecker(): void {
    const target = this.resolveHealthCheckTarget();
    if (!target) {
      return;
    }

    if (
      this.healthCheckTarget &&
      this.healthCheckTarget.url === target.url &&
      this.healthCheckTarget.path === target.path &&
      this.healthCheckTarget.port === target.port &&
      this.healthCheckTarget.host === target.host
    ) {
      return;
    }

    this.stopHealthChecker();
    this.healthCheckTarget = target;

    this.healthChecker = new HealthChecker(target, this.settings.healthCheckInterval, (healthy) => {
      const changed = this._healthy !== healthy;
      this._healthy = healthy;
      if (changed) {
        this.events.onHealthChange?.(this, healthy);
      }
      this.maybeUpdateReadiness();
    });

    this.healthChecker.start();
  }

  /**
   * Stop the health checker
   */
  private stopHealthChecker(): void {
    if (this.healthChecker) {
      this.healthChecker.stop();
      this.healthChecker = null;
    }
    this.healthCheckTarget = undefined;
  }

  /**
   * Verify that a port is actually listening by attempting TCP connection
   */
  private async verifyPortListening(port: number, maxAttempts = 10, initialDelay = 100): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this._status === "stopped" || this._status === "crashed") {
        return false;
      }

      const connected = await this.tryTcpConnect(port);
      if (connected) {
        return true;
      }

      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, etc. (capped at 2s)
      const delay = Math.min(initialDelay * Math.pow(2, attempt), 2000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return false;
  }

  /**
   * Try to establish a TCP connection to verify port is listening
   * Tries localhost (which resolves to IPv6 or IPv4) first, then falls back to 127.0.0.1
   */
  private tryTcpConnect(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      // Try localhost first (handles both IPv4 and IPv6)
      this.tryTcpConnectToHost(port, "localhost").then((success) => {
        if (success) {
          resolve(true);
        } else {
          // Fall back to explicit 127.0.0.1
          this.tryTcpConnectToHost(port, "127.0.0.1").then(resolve);
        }
      });
    });
  }

  private tryTcpConnectToHost(port: number, host: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 1000;

      socket.setTimeout(timeout);

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * Start port verification if we have a port to verify
   */
  private maybeStartPortVerification(): void {
    if (this.portVerified || this.portVerificationInProgress || !this._port) {
      return;
    }

    // Don't verify if health check is configured - let that handle readiness
    if (this.config.healthCheck) {
      return;
    }

    this.portVerificationInProgress = true;
    const portToVerify = this._port;
    // Capture current state sequence to detect if state changed during verification
    const currentSequence = this.stateSequence;

    this.verifyPortListening(portToVerify).then(async (success) => {
      // Use state lock to safely update state
      await this.stateLock.acquire();
      try {
        this.portVerificationInProgress = false;

        // Abort if state changed during verification (process was stopped/restarted)
        if (this.stateSequence !== currentSequence) {
          return;
        }

        if (success && this._port === portToVerify && this._status !== "stopped" && this._status !== "crashed") {
          this.portVerified = true;
          this.portDetected = true;

          // Now set the export since port is verified
          const exportPort = String(this._port);
          if (this._exports.port !== exportPort) {
            this._exports.port = exportPort;
            this.syncExportsMap();
            this.syncPortMap();
          }

          this.maybeUpdateReadiness();
        }
      } finally {
        this.stateLock.release();
      }
    });
  }

  private syncExportsMap(): void {
    if (this.envContext) {
      this.envContext.processExports.set(this.name, this._exports);
    }
  }

  private syncPortMap(): void {
    if (!this.envContext) {
      return;
    }

    if (this._port !== undefined) {
      this.envContext.processPorts.set(this.name, this._port);
    } else {
      this.envContext.processPorts.delete(this.name);
    }
  }

  private resetRuntimeState(): void {
    // Increment state sequence to invalidate any pending async operations
    this.stateSequence++;

    this.stopHealthChecker();
    this._healthy = undefined;
    this._ready = false;
    this._url = undefined;
    this._exports = {};
    this.portVerified = false;
    this.portVerificationInProgress = false;

    if (this.config.port !== undefined) {
      this._port = this.config.port;
      // Don't set _exports.port here - let port verification handle it
      this.portDetected = false;  // Will be set after detection from stdout
    } else {
      this._port = undefined;
      this.portDetected = false;
    }

    this.syncExportsMap();
    this.syncPortMap();
  }

  /**
   * Stop the process gracefully
   */
  async stop(timeout?: number): Promise<void> {
    const stopTimeout = timeout ?? this.settings.processStopTimeout;
    // Increment state sequence to invalidate any pending async operations
    this.stateSequence++;

    this._status = "stopped";
    this._ready = false;
    this.stopHealthChecker();

    if (this.paneId) {
      // Send interrupt signal first
      await this.tmuxManager.sendInterrupt(this.name);

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, Math.min(stopTimeout, 2000)));

      // Kill the pane
      await this.tmuxManager.killPane(this.name);
      this.paneId = null;
    }
  }

  /**
   * Restart the process
   * Uses respawn-pane to preserve crash logs in the tmux window
   */
  async restart(options: StartOptions = {}): Promise<void> {
    // Increment restart count and timestamp
    this._restartCount++;
    this._lastRestartTime = new Date();

    // Increment state sequence to invalidate pending async operations
    this.stateSequence++;

    // Stop health checker but don't kill the pane
    this.stopHealthChecker();

    // Reset runtime state (keeps paneId)
    this._ready = false;
    this._healthy = undefined;
    this._url = undefined;
    this._exports = {};
    this.portVerified = false;
    this.portVerificationInProgress = false;

    if (this.config.port !== undefined) {
      this._port = this.config.port;
      this.portDetected = false;
    } else {
      this._port = undefined;
      this.portDetected = false;
    }

    this.syncExportsMap();
    this.syncPortMap();

    // If pane was killed externally, fall back to full start
    if (!this.paneId) {
      console.error(`[termos] Pane for "${this.name}" was killed, creating new window`);
      await this.start(options);
      return;
    }

    if (!this.envContext) {
      throw new Error(`Environment context not set for process "${this.name}"`);
    }

    this._status = "starting";
    this._error = undefined;

    // Build environment variables
    const processEnv = this.buildEnvironment(options);

    // Resolve command
    const resolvedCommand = resolveCommand(this.config.command, this.envContext);

    // Validate and resolve extra arguments if provided
    let fullCommand = resolvedCommand;
    if (options.args) {
      const validatedArgs = validateCommandArgs(options.args);
      const resolvedArgs = resolveCommand(validatedArgs, this.envContext);
      fullCommand = `${resolvedCommand} ${resolvedArgs}`;
    }

    // Build restart banner
    const time = new Date().toLocaleTimeString();
    const exitInfo = this._exitCode !== undefined ? `exit code ${this._exitCode}` : "unknown exit";
    // Show env var names (not values - they may be sensitive)
    const envVarNames = Object.keys(processEnv).filter(k => !process.env[k] || process.env[k] !== processEnv[k]);
    const envDisplay = envVarNames.length > 0 ? `env: ${envVarNames.join(", ")}` : "";
    const cwdDisplay = `cwd: ${this.config.resolvedCwd}`;
    const banner = [
      "echo ''",
      `echo '╔════════════════════════════════════════════════════════════╗'`,
      `echo '║  🔄 RESTARTING (attempt ${this._restartCount}/${this.config.maxRestarts})'`,
      `echo '║  Previous: ${exitInfo}'`,
      `echo '║  Time: ${time}'`,
      `echo '╚════════════════════════════════════════════════════════════╝'`,
      `echo '$ ${fullCommand.replace(/'/g, "'\\''")}'`,
      `echo '  ${cwdDisplay.replace(/'/g, "'\\''")}'`,
      envDisplay ? `echo '  ${envDisplay.replace(/'/g, "'\\''")}'` : "true",
      "echo ''",
    ].join(" && ");

    // Prepend banner to command
    const commandWithBanner = `${banner} && ${fullCommand}`;

    this.lastCapturedOutput = "";
    console.error(`[termos] Restarting "${this.name}" in tmux window (pane ${this.paneId})`);

    // Respawn in existing pane
    await this.tmuxManager.respawnPane(
      this.name,
      commandWithBanner,
      this.config.resolvedCwd,
      processEnv
    );

    // Mark as running and start readiness checks
    this._status = "running";
    this.maybeStartHealthChecker();
    this.maybeStartPortVerification();
    this.maybeUpdateReadiness();
  }

  /**
   * Get the current state
   */
  getState(): ProcessState {
    return {
      name: this.name,
      status: this._status,
      pid: undefined, // tmux manages the actual pid
      port: this._port,
      url: this._url ?? (this._port ? `http://localhost:${this._port}` : undefined),
      restartCount: this._restartCount,
      lastRestartTime: this._lastRestartTime,
      healthy: this._healthy,
      exitCode: this._exitCode,
      error: this._error,
    };
  }

  /**
   * Get logs (synchronous, from buffer)
   * Note: stdout/stderr are combined in tmux mode
   */
  getLogs(_stream: "stdout" | "stderr" | "combined" = "combined", tail?: number): string[] {
    // tmux combines stdout/stderr, all streams return the same data
    return this.combined.tail(tail);
  }

  /**
   * Get logs asynchronously (captures fresh output from tmux pane)
   */
  async getLogsAsync(lines = 100): Promise<string> {
    if (this.paneId) {
      // Capture fresh output from tmux pane
      return await this.tmuxManager.capturePane(this.name, lines);
    }

    // Fall back to buffered logs if pane not active
    return this.combined.tail(lines).join("\n");
  }

  /**
   * Get status
   */
  get status(): ProcessStatus {
    return this._status;
  }

  /**
   * Get exported variables
   */
  get exports(): Record<string, string> {
    return this._exports;
  }

  /**
   * Get port
   */
  get port(): number | undefined {
    return this._port;
  }

  /**
   * Get URL
   */
  get url(): string | undefined {
    return this._url ?? (this._port ? `http://localhost:${this._port}` : undefined);
  }

  /**
   * Check if process is ready for dependents
   * For long-running processes: ready when readiness conditions are met
   * For one-shot processes (restartPolicy: never): ready when completed successfully
   */
  get isReady(): boolean {
    return this._ready || this._status === "completed";
  }

  /**
   * Get restart count
   */
  get restartCount(): number {
    return this._restartCount;
  }
}
