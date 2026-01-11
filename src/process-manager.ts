import { EventEmitter } from "events";
import * as path from "path";
import { fileURLToPath } from "url";
import { Config, ProcessConfig, ResolvedProcessConfig, resolveProcessConfigs, sortByDependencies, Settings, tabsEqual, getTabType, TabsConfig, normalizeTabToService } from "./config.js";
import { ManagedProcess, ProcessState, StartOptions, ProcessSettings } from "./process.js";
import { EnvContext } from "./env-resolver.js";
import { TmuxManager } from "./tmux-manager.js";
import { emitReadyEvent, emitErrorEvent, getLatestStatus } from "./events.js";

// Get directory of this module (for finding bundled components)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic terminal info
export interface DynamicTerminal {
  name: string;
  command: string;
  group: string;
  paneId: string;
  createdAt: Date;
}

// Deep compare two process configs (ignoring computed fields)
function configsEqual(a: ProcessConfig, b: ProcessConfig): boolean {
  return (
    a.command === b.command &&
    a.cwd === b.cwd &&
    a.port === b.port &&
    a.autoStart === b.autoStart &&
    JSON.stringify(a.stdoutPatternVars ?? {}) === JSON.stringify(b.stdoutPatternVars ?? {}) &&
    JSON.stringify(a.readyVars ?? []) === JSON.stringify(b.readyVars ?? []) &&
    a.envFile === b.envFile &&
    a.restartPolicy === b.restartPolicy &&
    a.maxRestarts === b.maxRestarts &&
    a.healthCheck === b.healthCheck &&
    a.dependsOn === b.dependsOn &&
    JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {})
  );
}

export interface ProcessManagerEvents {
  onProcessReady?: (name: string) => void;
  onProcessCrash?: (name: string, exitCode: number | null) => void;
  onLog?: (name: string, line: string, stream: "stdout" | "stderr") => void;
  onHealthChange?: (name: string, healthy: boolean) => void;
}

export interface ProcessManagerOptions {
  events?: ProcessManagerEvents;
  settings?: Settings;
  tmuxManager: TmuxManager;
}

/**
 * Manages all background processes
 */
export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private processConfigs = new Map<string, ResolvedProcessConfig>();
  private events: ProcessManagerEvents;
  private configDir: string;
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private currentConfig: Config | null = null;
  private envContext: EnvContext | null = null;
  private dependencyTimeout: number;
  private processSettings: ProcessSettings;
  private restartBackoffMax: number;

  // Tmux manager (required)
  private tmuxManager: TmuxManager;
  private tmuxPollInterval: NodeJS.Timeout | null = null;
  private tmuxPollRate = 500; // Fast polling during startup
  private tmuxSlowPollRate = 3000; // Slow polling after ready

  // Dynamic terminals (created at runtime via MCP tools)
  private dynamicTerminals = new Map<string, DynamicTerminal>();

  // Tab state
  private welcomePaneActive = false;
  private tabIndices = new Map<string, number>(); // tab name -> window index
  private layoutTabs = new Set<string>(); // names of layout tabs (vs service tabs)

  constructor(configDir: string, options: ProcessManagerOptions) {
    super();
    this.configDir = configDir;
    this.events = options.events ?? {};
    this.tmuxManager = options.tmuxManager;

    // Apply settings from config or use defaults
    const settings = options.settings;
    this.dependencyTimeout = settings?.dependencyTimeout ?? 60000;
    this.restartBackoffMax = settings?.restartBackoffMax ?? 30000;
    this.processSettings = {
      logBufferSize: settings?.logBufferSize ?? 1000,
      healthCheckInterval: settings?.healthCheckInterval ?? 10000,
      restartBackoffMax: settings?.restartBackoffMax ?? 30000,
      processStopTimeout: settings?.processStopTimeout ?? 5000,
    };
  }

  /**
   * Get the tmux session name
   */
  get tmuxSessionName(): string {
    return this.tmuxManager.sessionName;
  }

  /**
   * Check if a tab is a layout tab
   */
  isLayoutTab(name: string): boolean {
    return this.layoutTabs.has(name);
  }

  /**
   * List all tabs with their info (both service and layout tabs)
   */
  listTabs(): Array<{
    name: string;
    type: "service" | "layout";
    windowIndex: number;
    status?: string;
    port?: number;
    healthy?: boolean;
  }> {
    return Array.from(this.tabIndices.entries()).map(([name, windowIndex]) => {
      const isLayout = this.layoutTabs.has(name);
      const process = this.processes.get(name);
      const state = process?.getState();

      return {
        name,
        type: isLayout ? "layout" as const : "service" as const,
        windowIndex,
        status: state?.status,
        port: state?.port,
        healthy: state?.healthy,
      };
    });
  }

  /**
   * Load process definitions from config without starting them
   * Useful for CLI tools that need to query status of already-running processes
   */
  async loadProcesses(config: Config): Promise<void> {
    this.currentConfig = config;

    // Resolve and sort processes
    const resolved = resolveProcessConfigs(config, this.configDir);
    const sorted = sortByDependencies(resolved);

    // Build port map for processes with fixed ports (for env var interpolation)
    const portMap = new Map<string, number>();
    const exportMap = new Map<string, Record<string, string>>();
    for (const processConfig of sorted) {
      if (processConfig.port) {
        portMap.set(processConfig.name, processConfig.port);
        exportMap.set(processConfig.name, { port: String(processConfig.port) });
      }
    }

    // Create env context
    const envContext: EnvContext = {
      processPorts: portMap,
      processExports: exportMap,
      systemEnv: process.env,
    };
    this.envContext = envContext;

    this.processes.clear();
    this.processConfigs.clear();

    // Discover existing windows in the tmux session
    const existingWindows = await this.tmuxManager.discoverWindows();

    // Track which tabs are layout tabs (array config = layout, string/object = service)
    this.layoutTabs.clear();
    const configTabNames = new Set<string>();
    if (config.tabs) {
      for (const [name, tabConfig] of Object.entries(config.tabs)) {
        configTabNames.add(name);
        if (Array.isArray(tabConfig)) {
          this.layoutTabs.add(name);
        }
      }
    }

    // Discover window indices for tabIndices map (only for tabs in config)
    const windowIndices = await this.tmuxManager.discoverWindowIndices();
    this.tabIndices.clear();
    for (const [name, index] of windowIndices) {
      // Only include tabs that are in the config (skip welcome window, etc)
      if (configTabNames.has(name)) {
        this.tabIndices.set(name, index);
      }
    }

    // Discover existing panes in Canvas (window 0) for dynamic terminals
    const existingPanes = await this.tmuxManager.discoverCanvasPanes();
    for (const [name, paneId] of existingPanes) {
      if (!this.dynamicTerminals.has(name)) {
        this.dynamicTerminals.set(name, {
          name,
          command: "(recovered)",
          group: "dynamic",
          paneId,
          createdAt: new Date(),
        });
      }
    }

    // Register all processes (but don't start them)
    for (const processConfig of sorted) {
      const process = this.registerProcess(processConfig, envContext, portMap);

      // If the process has a running window in tmux, attach to it
      const paneId = existingWindows.get(processConfig.name);
      if (paneId) {
        process.attachToExistingPane(paneId);
      }
    }

    // Start tmux polling to update status from running windows
    this.startTmuxPolling();
  }

  /**
   * Initialize and start all tabs from config
   */
  async startAll(config: Config): Promise<void> {
    // Load service processes first (for ManagedProcess tracking)
    await this.loadProcesses(config);

    // Start tabs (welcome + all configured tabs)
    await this.startTabs(config);
  }

  /**
   * Start all tabs from config
   * Window 0 always shows welcome, tabs start at window 1+
   */
  async startTabs(config: Config): Promise<void> {
    // Always show welcome in window 0
    await this.showWelcomeComponent();
    this.welcomePaneActive = true;

    // Create all tabs from config
    if (config.tabs && Object.keys(config.tabs).length > 0) {
      console.error(`[termos] Creating ${Object.keys(config.tabs).length} tab(s)`);

      // Track which tabs are layouts vs services
      this.layoutTabs.clear();
      for (const [name, tabConfig] of Object.entries(config.tabs)) {
        if (getTabType(tabConfig) === "layout") {
          this.layoutTabs.add(name);
        }
      }

      // Create tabs using tmux manager
      this.tabIndices = await this.tmuxManager.createAllTabs(
        config.tabs,
        this.configDir,
        // Callback for service tabs - start their managed process
        (name: string, _paneId: string, _windowIndex: number) => {
          const processConfig = this.processConfigs.get(name);
          if (processConfig) {
            const blockReason = this.getAutoStartBlockReason(processConfig);
            if (blockReason) {
              console.error(`[termos] Not auto-starting "${name}" (${blockReason})`);
              return;
            }
            this.startManagedProcess(processConfig);
          }
        }
      );

      // Update welcome with tab info
      await this.showWelcomeComponent();
    }
  }

  /**
   * Show the welcome Ink component in window 0
   */
  async showWelcomeComponent(): Promise<void> {
    // Build tab info for welcome display
    const tabs = Array.from(this.tabIndices.entries()).map(([name, windowIndex]) => {
      const isLayout = this.layoutTabs.has(name);
      const process = this.processes.get(name);
      const state = process?.getState();

      return {
        name,
        windowIndex,
        type: isLayout ? "layout" : "service",
        status: state?.status,
        restartCount: state?.restartCount,
        port: state?.port,
        healthy: state?.healthy,
      };
    });

    // Find interactive files in .termos/interactive/ (project) and ~/.termos/interactive/ (global)
    let projectInteractive: string[] = [];
    let globalInteractive: string[] = [];

    const projectInteractiveDir = path.join(this.configDir, ".termos/interactive");
    const globalInteractiveDir = path.join(process.env.HOME || "~", ".termos/interactive");

    try {
      const fs = await import("fs");
      if (fs.existsSync(projectInteractiveDir)) {
        projectInteractive = fs.readdirSync(projectInteractiveDir)
          .filter(f => f.endsWith(".tsx"))
          .sort();
      }
      if (fs.existsSync(globalInteractiveDir)) {
        globalInteractive = fs.readdirSync(globalInteractiveDir)
          .filter(f => f.endsWith(".tsx"))
          .sort();
      }
    } catch {
      // Ignore errors
    }

    // Get latest LLM status
    const statusEvent = getLatestStatus(this.tmuxManager.configDir);

    const args = {
      sessionName: this.tmuxManager.sessionName,
      tabs,
      projectInteractive,
      globalInteractive,
      status: statusEvent?.message ?? undefined,
      prompts: statusEvent?.prompts,
    };

    // Find the ink-runner components directory
    // Use module's location to find bundled components
    const moduleRoot = path.resolve(__dirname, "..");
    const possiblePaths = [
      // Bundled in dist (production and dev after build)
      path.join(moduleRoot, "dist/ink-runner/components/welcome.tsx"),
      // Development (packages source)
      path.join(moduleRoot, "packages/ink-runner/components/welcome.tsx"),
      // Installed via npm
      path.join(process.cwd(), "node_modules/mcp-ide/dist/ink-runner/components/welcome.tsx"),
    ];

    let welcomePath: string | null = null;
    for (const p of possiblePaths) {
      try {
        await import("fs").then(fs => fs.promises.access(p));
        welcomePath = p;
        break;
      } catch {
        // Continue to next path
      }
    }

    if (!welcomePath) {
      // Fallback: show a simple message that stays alive
      console.error("[termos] Welcome component not found, using fallback");
      const fallbackCmd = `echo "Welcome to Termos - Session: ${this.tmuxManager.sessionName}" && echo "" && echo "Tabs: Use Ctrl-b <number> to switch tabs" && echo "" && tail -f /dev/null`;
      const initialPaneId = await this.tmuxManager.getWindow0InitialPaneId();
      if (initialPaneId) {
        this.tmuxManager.registerPane("__welcome__", initialPaneId);
        await this.tmuxManager.respawnPane("__welcome__", fallbackCmd, this.configDir);
      }
      return;
    }

    // Find ink-runner path
    const inkRunnerPath = path.dirname(path.dirname(welcomePath));
    const inkRunner = path.join(inkRunnerPath, "dist/index.js");

    // Build the command to run the welcome component
    const welcomeCommand = `node "${inkRunner}" --file "${welcomePath}" --args '${JSON.stringify(args).replace(/'/g, "'\\''")}'`;

    // Respawn window 0's initial pane with welcome component
    const initialPaneId = await this.tmuxManager.getWindow0InitialPaneId();
    if (initialPaneId) {
      this.tmuxManager.registerPane("__welcome__", initialPaneId);
      await this.tmuxManager.respawnPane("__welcome__", welcomeCommand, this.configDir);
      console.error("[termos] Welcome component started");
    }
  }

  /**
   * Register a process without starting it
   */
  private registerProcess(
    processConfig: ResolvedProcessConfig,
    envContext: EnvContext,
    portMap: Map<string, number>
  ): ManagedProcess {
    const managedProcess = new ManagedProcess(
      processConfig,
      this.configDir,
      {
        onReady: (p) => {
          // Update port map when port is detected
          if (p.port) {
            portMap.set(p.name, p.port);
          }
          this.events.onProcessReady?.(p.name);
          // Emit event for dependency waiting
          this.emit("processReady", p.name);
          // Write to events file
          emitReadyEvent(this.tmuxManager.configDir, p.name, p.port, p.url);
          // Adjust poll rate once processes are ready
          this.adjustTmuxPollRate();
          // Refresh welcome component to show updated status
          this.showWelcomeComponent();
        },
        onCrash: (p, exitCode) => {
          this.events.onProcessCrash?.(p.name, exitCode);
          // Emit event for dependency waiting (in case something is waiting)
          this.emit("processFailed", p.name, exitCode);
          // Write to events file
          emitErrorEvent(this.tmuxManager.configDir, p.name, "Process crashed", exitCode ?? undefined);
          this.handleCrash(p.name, processConfig);
          // Refresh welcome component to show updated status
          this.showWelcomeComponent();
        },
        onLog: (p, line, stream) => {
          this.events.onLog?.(p.name, line, stream);
        },
        onHealthChange: (p, healthy) => {
          this.events.onHealthChange?.(p.name, healthy);
        },
      },
      this.processSettings,
      this.tmuxManager
    );

    // Set env context for variable interpolation
    managedProcess.setEnvContext({
      ...envContext,
      currentPort: processConfig.port,
    });

    this.processes.set(processConfig.name, managedProcess);
    this.processConfigs.set(processConfig.name, processConfig);

    return managedProcess;
  }

  /**
   * Start a registered process
   */
  private async startManagedProcess(
    processConfig: ResolvedProcessConfig,
    options?: StartOptions
  ): Promise<void> {
    if (!this.envContext) {
      throw new Error("Environment context not initialized");
    }

    const managedProcess = this.processes.get(processConfig.name);
    if (!managedProcess) {
      throw new Error(`Process "${processConfig.name}" not found`);
    }

    // Wait for all dependencies (supports multiple dependencies)
    if (processConfig.dependsOn && processConfig.dependsOn.length > 0) {
      // Check if any dependency is autoStart=false and not ready
      for (const depName of processConfig.dependsOn) {
        const dependencyConfig = this.processConfigs.get(depName);
        const dependency = this.processes.get(depName);
        if (dependencyConfig?.autoStart === false && !dependency?.isReady) {
          throw new Error(
            `Process "${processConfig.name}" depends on "${depName}" which is not started`
          );
        }
      }

      // Wait for all dependencies in parallel
      await Promise.all(
        processConfig.dependsOn.map((depName) => this.waitForReady(depName))
      );
    }

    managedProcess.setEnvContext({
      ...this.envContext,
      currentPort: processConfig.port,
    });

    await managedProcess.start(options);
  }

  private shouldAutoStart(processConfig: ResolvedProcessConfig): boolean {
    return !this.getAutoStartBlockReason(processConfig);
  }

  private getAutoStartBlockReason(processConfig: ResolvedProcessConfig): string | null {
    if (processConfig.autoStart === false) {
      return "autoStart=false";
    }

    // Check all dependencies for autoStart=false
    if (processConfig.dependsOn) {
      for (const depName of processConfig.dependsOn) {
        const dependencyConfig = this.processConfigs.get(depName);
        if (dependencyConfig?.autoStart === false) {
          return `dependsOn "${depName}" which is autoStart=false`;
        }
      }
    }

    return null;
  }

  /**
   * Reload config and apply changes (stop removed, start added, restart changed)
   */
  async reload(newConfig: Config): Promise<{ added: string[]; removed: string[]; changed: string[]; tabsReloaded: boolean }> {
    const oldProcessNames = new Set(this.processConfigs.keys());

    // Track which processes were running before reload (for autoStart=false)
    const wasRunning = new Set<string>();
    for (const [name, process] of this.processes) {
      if (process.isRunning()) {
        wasRunning.add(name);
      }
    }

    // Get service tabs from new config (filter out layout tabs)
    const newServiceTabs = newConfig.tabs
      ? Object.entries(newConfig.tabs)
          .filter(([, config]) => getTabType(config) === "service")
          .map(([name]) => name)
      : [];
    const newProcessNames = new Set(newServiceTabs);

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    // Find removed processes
    for (const name of oldProcessNames) {
      if (!newProcessNames.has(name)) {
        removed.push(name);
      }
    }

    // Find added and changed processes
    for (const name of newServiceTabs) {
      const tabConfig = newConfig.tabs![name];
      const newProcessConfig = normalizeTabToService(name, tabConfig);
      if (!newProcessConfig) continue;

      if (!oldProcessNames.has(name)) {
        added.push(name);
      } else {
        const oldConfig = this.processConfigs.get(name);
        if (oldConfig && !configsEqual(oldConfig, newProcessConfig)) {
          changed.push(name);
        }
      }
    }

    // Stop removed processes
    for (const name of removed) {
      console.error(`[termos] Stopping removed process "${name}"`);
      const process = this.processes.get(name);
      if (process) {
        await process.stop();
        this.processes.delete(name);
        this.processConfigs.delete(name);
      }
      // Clear any restart timer
      const timer = this.restartTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.restartTimers.delete(name);
      }
    }

    // Restart changed processes
    for (const name of changed) {
      console.error(`[termos] Restarting changed process "${name}"`);
      const process = this.processes.get(name);
      if (process) {
        await process.stop();
        this.processes.delete(name);
        this.processConfigs.delete(name);
      }
      const timer = this.restartTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.restartTimers.delete(name);
      }
    }

    // Save old tabs before updating config (for hot-reload comparison)
    const oldTabs = this.currentConfig?.tabs;

    // Update config
    this.currentConfig = newConfig;

    // Resolve new configs
    const resolved = resolveProcessConfigs(newConfig, this.configDir);
    const sorted = sortByDependencies(resolved);

    // Build port map
    const portMap = new Map<string, number>();
    const exportMap = new Map<string, Record<string, string>>();
    for (const pc of sorted) {
      if (pc.port) {
        portMap.set(pc.name, pc.port);
      }
      // Include existing running process ports
      const existing = this.processes.get(pc.name);
      if (existing?.port) {
        portMap.set(pc.name, existing.port);
      }

      const existingExports = existing?.exports;
      if (existingExports) {
        exportMap.set(pc.name, existingExports);
      } else if (pc.port) {
        exportMap.set(pc.name, { port: String(pc.port) });
      }
    }

    const envContext: EnvContext = {
      processPorts: portMap,
      processExports: exportMap,
      systemEnv: process.env,
    };
    this.envContext = envContext;

    // Register added/changed processes and update env context for existing ones
    for (const processConfig of sorted) {
      if (added.includes(processConfig.name) || changed.includes(processConfig.name)) {
        this.registerProcess(processConfig, envContext, portMap);
      } else {
        const existing = this.processes.get(processConfig.name);
        if (existing) {
          existing.setEnvContext({
            ...envContext,
            currentPort: processConfig.port,
          });
        }
        this.processConfigs.set(processConfig.name, processConfig);
      }
    }

    // Start added and changed processes (in dependency order)
    for (const processConfig of sorted) {
      if (added.includes(processConfig.name) || changed.includes(processConfig.name)) {
        const blockReason = this.getAutoStartBlockReason(processConfig);
        if (blockReason && !wasRunning.has(processConfig.name)) {
          console.error(`[termos] Not auto-starting "${processConfig.name}" (${blockReason})`);
          continue;
        }
        console.error(`[termos] Starting process "${processConfig.name}"`);
        await this.startManagedProcess(processConfig);
      }
    }

    // Check if tabs changed - if so, kill and recreate all tab windows (preserve Tab 0)
    const newTabs = newConfig.tabs;
    let tabsReloaded = false;

    if (!tabsEqual(oldTabs, newTabs)) {
      console.error("[termos] Tabs config changed - recreating all tabs");

      // Kill all tab windows (windows 1+)
      await this.tmuxManager.killAllTabWindows();

      // Clear tab tracking
      this.tabIndices.clear();
      this.layoutTabs.clear();

      // Track which tabs are layouts
      if (newTabs) {
        for (const [name, tabConfig] of Object.entries(newTabs)) {
          if (getTabType(tabConfig) === "layout") {
            this.layoutTabs.add(name);
          }
        }

        // Recreate all tabs
        this.tabIndices = await this.tmuxManager.createAllTabs(
          newTabs,
          this.configDir,
          (name: string, _paneId: string, _windowIndex: number) => {
            const processConfig = this.processConfigs.get(name);
            if (processConfig) {
              const blockReason = this.getAutoStartBlockReason(processConfig);
              if (blockReason && !wasRunning.has(name)) {
                console.error(`[termos] Not auto-starting "${name}" (${blockReason})`);
                return;
              }
              this.startManagedProcess(processConfig);
            }
          }
        );
      }

      tabsReloaded = true;
    }

    // Update welcome component to reflect any changes
    await this.showWelcomeComponent();

    return { added, removed, changed, tabsReloaded };
  }

  /**
   * Wait for a process to be ready using events (no polling)
   */
  private waitForReady(name: string, timeout?: number): Promise<void> {
    const timeoutMs = timeout ?? this.dependencyTimeout;

    return new Promise((resolve, reject) => {
      const process = this.processes.get(name);
      if (!process) {
        reject(new Error(`Process "${name}" not found`));
        return;
      }

      if (process.isReady) {
        resolve();
        return;
      }

      // Check if already failed
      if (process.status === "crashed" || process.status === "stopped") {
        reject(new Error(`Process "${name}" crashed or stopped while waiting`));
        return;
      }

      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        this.off("processReady", onReady);
        this.off("processFailed", onFailed);
        clearTimeout(timer);
      };

      const onReady = (readyName: string) => {
        if (readyName === name) {
          cleanup();
          resolve();
        }
      };

      const onFailed = (failedName: string) => {
        if (failedName === name) {
          cleanup();
          reject(new Error(`Process "${name}" crashed or stopped while waiting`));
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for process "${name}" to be ready (${timeoutMs}ms)`));
      }, timeoutMs);

      this.on("processReady", onReady);
      this.on("processFailed", onFailed);
    });
  }

  /**
   * Handle a process crash/exit based on restartPolicy
   * - "always": restart on any exit (with exponential backoff)
   * - "onFailure": restart only on non-zero exit
   * - "never": don't restart
   */
  private handleCrash(name: string, config: ResolvedProcessConfig): void {
    const process = this.processes.get(name);
    if (!process) return;

    const exitCode = process.getState().exitCode;
    const shouldRestart = this.shouldRestart(config.restartPolicy, exitCode);

    if (shouldRestart && process.restartCount < config.maxRestarts) {
      // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at configurable max
      const delay = Math.min(Math.pow(2, process.restartCount) * 1000, this.restartBackoffMax);

      // Clear any existing restart timer
      const existingTimer = this.restartTimers.get(name);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      console.error(`[termos] Process "${name}" exited (code=${exitCode}), restarting in ${delay}ms (attempt ${process.restartCount + 1}/${config.maxRestarts})`);

      // Schedule restart
      const timer = setTimeout(async () => {
        this.restartTimers.delete(name);
        try {
          await process.restart();
        } catch (err) {
          console.error(`Failed to restart process "${name}":`, err);
        }
      }, delay);

      this.restartTimers.set(name, timer);
    } else if (shouldRestart) {
      console.error(`[termos] Process "${name}" exceeded max restarts (${config.maxRestarts}), giving up`);
      // Show failure banner in the pane
      this.showFailureBanner(name, exitCode, config.maxRestarts);
    }
  }

  /**
   * Show a failure banner in a crashed process's tmux pane
   */
  private async showFailureBanner(name: string, exitCode: number | undefined, maxRestarts: number): Promise<void> {
    const time = new Date().toLocaleTimeString();
    const exitInfo = exitCode !== undefined ? `exit code ${exitCode}` : "unknown exit";

    // Get the command and config from process
    const processConfig = this.processConfigs.get(name);
    const cmd = processConfig?.command || "unknown";
    const cwd = processConfig?.resolvedCwd || this.configDir;

    // Get env var names (not values - they may be sensitive)
    const envVarNames: string[] = [];
    if (processConfig?.env) {
      envVarNames.push(...Object.keys(processConfig.env));
    }
    if (processConfig?.envFile) {
      envVarNames.push(`(from ${processConfig.envFile})`);
    }
    const envDisplay = envVarNames.length > 0 ? `env: ${envVarNames.join(", ")}` : "";

    // Respawn the pane with just the banner message (keeps pane alive to show logs)
    const bannerCommand = [
      "echo ''",
      `echo '╔════════════════════════════════════════════════════════════╗'`,
      `echo '║  ❌ PROCESS FAILED - Max restarts (${maxRestarts}) exceeded'`,
      `echo '║  Last: ${exitInfo}'`,
      `echo '║  Time: ${time}'`,
      `echo '╚════════════════════════════════════════════════════════════╝'`,
      `echo '$ ${cmd.replace(/'/g, "'\\''")}'`,
      `echo '  cwd: ${cwd.replace(/'/g, "'\\''")}'`,
      envDisplay ? `echo '  ${envDisplay.replace(/'/g, "'\\''")}'` : "true",
      "echo ''",
      "echo 'Scroll up to view logs. Press Enter to close.'",
      "read",  // Wait for user input before closing
    ].join(" && ");

    try {
      await this.tmuxManager.respawnPane(name, bannerCommand, this.configDir);
    } catch {
      // Ignore errors - pane might be in an unexpected state
    }
  }

  /**
   * Determine if a process should restart based on policy and exit code
   */
  private shouldRestart(policy: string, exitCode: number | undefined): boolean {
    switch (policy) {
      case "always":
        return true;
      case "onFailure":
        return exitCode !== 0;
      case "never":
        return false;
      default:
        return false;
    }
  }

  /**
   * Stop all processes
   */
  async stopAll(): Promise<void> {
    // Stop tmux polling
    this.stopTmuxPolling();

    // Clear all restart timers
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();

    // Stop all processes in parallel
    const stopPromises = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.all(stopPromises);

    // Destroy the tmux session
    await this.tmuxManager.destroySession();
  }

  /**
   * Start a process by name (optionally with extra args/env)
   */
  async startProcess(name: string, options?: StartOptions): Promise<void> {
    const config = this.processConfigs.get(name);
    if (!config) {
      throw new Error(`Process "${name}" not found`);
    }

    if (!this.envContext) {
      throw new Error("Environment context not initialized");
    }

    let process = this.processes.get(name);
    if (!process) {
      process = this.registerProcess(config, this.envContext, this.envContext.processPorts);
    }

    if (process.status === "running" || process.status === "ready" || process.status === "starting") {
      throw new Error(`Process "${name}" is already running`);
    }

    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }

    await this.startManagedProcess(config, options);
  }

  /**
   * Restart a process only if it is currently running
   */
  async restartIfRunning(name: string): Promise<boolean> {
    const process = this.processes.get(name);
    if (!process) {
      return false;
    }

    if (process.status === "running" || process.status === "ready" || process.status === "starting") {
      const timer = this.restartTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.restartTimers.delete(name);
      }
      await process.restart();
      return true;
    }

    return false;
  }

  /**
   * Get a process by name
   */
  getProcess(name: string): ManagedProcess | undefined {
    return this.processes.get(name);
  }

  /**
   * List all processes
   */
  listProcesses(): ProcessState[] {
    return Array.from(this.processes.values()).map((p) => p.getState());
  }

  /**
   * Get logs for a process
   */
  getLogs(name: string, stream: "stdout" | "stderr" | "combined" = "combined", tail?: number): string[] {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    return process.getLogs(stream, tail);
  }

  /**
   * Get URL for a process
   */
  getUrl(name: string): string | undefined {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    return process.url;
  }

  /**
   * Restart a process
   */
  async restartProcess(name: string): Promise<void> {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }
    await process.restart();
  }

  /**
   * Stop a process permanently (until manually started again)
   */
  async stopProcess(name: string): Promise<void> {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }

    // Clear any pending restart timer
    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }

    // Stop the process
    await process.stop();

    // Update status
  }

  /**
   * Get status of a process
   */
  getStatus(name: string): ProcessState {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    return process.getState();
  }

  /**
   * Get all process names
   */
  getProcessNames(): string[] {
    return Array.from(this.processes.keys());
  }

  // ============================================
  // Dynamic terminal methods
  // ============================================

  /**
   * Get available group names for dynamic terminals
   */
  getAvailableGroups(): string[] {
    return ["dynamic"];
  }

  /**
   * Create a dynamic terminal in a specific group
   * If welcome pane is active and is the only pane, replaces it
   */
  async createDynamicTerminal(name: string, command: string, group?: string): Promise<DynamicTerminal> {
    // Check if name is already used by a configured process
    if (this.processes.has(name)) {
      throw new Error(`Name "${name}" is already used by a configured process`);
    }

    // Check if name is already used by a dynamic terminal
    if (this.dynamicTerminals.has(name)) {
      throw new Error(`Dynamic terminal "${name}" already exists`);
    }

    // Check if we should replace the welcome pane
    if (this.welcomePaneActive && await this.tmuxManager.isOnlyWelcomePane()) {
      // Replace welcome pane with the new terminal
      const initialPaneId = await this.tmuxManager.getWindow0InitialPaneId();
      if (initialPaneId) {
        // Register the pane and respawn it with the new command
        this.tmuxManager.registerPane(name, initialPaneId);
        await this.tmuxManager.respawnPane(name, command, this.configDir);

        // Clear welcome state
        this.welcomePaneActive = false;
        this.tmuxManager.unregisterPane("__welcome__");

        const terminal: DynamicTerminal = {
          name,
          command,
          group: "dashboard",
          paneId: initialPaneId,
          createdAt: new Date(),
        };

        this.dynamicTerminals.set(name, terminal);
        console.error(`[termos] Replaced welcome pane with terminal "${name}"`);

        return terminal;
      }
    }

    // Create the pane in window 0
    const targetGroup = group ?? "dynamic";
    const paneId = await this.tmuxManager.createPane(
      name,
      command,
      this.configDir,
      undefined,
      { targetWindow: 0, setTitle: true }
    );

    const terminal: DynamicTerminal = {
      name,
      command,
      group: targetGroup,
      paneId,
      createdAt: new Date(),
    };

    this.dynamicTerminals.set(name, terminal);
    console.error(`[termos] Created dynamic terminal "${name}" in group "${targetGroup}"`);

    return terminal;
  }

  /**
   * Remove a dynamic terminal
   */
  async removeDynamicTerminal(name: string): Promise<void> {
    const terminal = this.dynamicTerminals.get(name);
    if (!terminal) {
      // Check if it's a configured process
      if (this.processes.has(name)) {
        throw new Error(`"${name}" is a configured process, not a dynamic terminal. Use stop_process instead.`);
      }
      throw new Error(`Dynamic terminal "${name}" not found`);
    }

    // Kill the tmux pane
    await this.tmuxManager.killPane(name);

    this.dynamicTerminals.delete(name);
    console.error(`[termos] Removed dynamic terminal "${name}"`);
  }

  /**
   * List all dynamic terminals
   */
  listDynamicTerminals(): DynamicTerminal[] {
    return Array.from(this.dynamicTerminals.values());
  }

  /**
   * Get a dynamic terminal by name
   */
  getDynamicTerminal(name: string): DynamicTerminal | undefined {
    return this.dynamicTerminals.get(name);
  }

  // ============================================
  // Tmux polling methods
  // ============================================

  /**
   * Start tmux status polling
   */
  private startTmuxPolling(): void {
    if (this.tmuxPollInterval) return;

    const poll = async () => {
      await this.pollTmuxProcesses();
    };

    // Start with fast polling
    this.tmuxPollInterval = setInterval(poll, this.tmuxPollRate);
    // Run immediately
    poll();
  }

  /**
   * Stop tmux status polling
   */
  private stopTmuxPolling(): void {
    if (this.tmuxPollInterval) {
      clearInterval(this.tmuxPollInterval);
      this.tmuxPollInterval = null;
    }
  }

  /**
   * Adjust poll rate based on process readiness
   * Fast polling during startup, slow polling once stable
   */
  private adjustTmuxPollRate(): void {
    if (!this.tmuxPollInterval) return;

    // Check if all processes are ready or stable
    const allReady = Array.from(this.processes.values()).every(
      (p) => p.isReady || p.status === "stopped" || p.status === "crashed" || p.status === "completed"
    );

    if (allReady) {
      // Switch to slow polling
      this.stopTmuxPolling();
      this.tmuxPollInterval = setInterval(() => this.pollTmuxProcesses(), this.tmuxSlowPollRate);
    }
  }

  /**
   * Poll all tmux processes for status updates
   */
  private async pollTmuxProcesses(): Promise<void> {
    for (const [, process] of this.processes) {
      // Only poll running processes
      if (process.status === "running" || process.status === "starting" || process.status === "ready") {
        await process.pollTmuxStatus();
      }
    }
  }
}
