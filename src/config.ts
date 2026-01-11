import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

// Restart policy enum (Kubernetes-style)
export const RestartPolicySchema = z.enum(["always", "onFailure", "never"]).default("onFailure");
export type RestartPolicy = z.infer<typeof RestartPolicySchema>;

// Schema for a single process configuration
export const ProcessConfigSchema = z.object({
  command: z.string().describe("Shell command to run"),
  cwd: z.string().optional().describe("Working directory, relative to config file"),
  port: z.number().optional().describe("Fixed port (injected as $PORT env var)"),
  force: z.boolean().default(false).describe("Kill any process using the configured port before starting"),
  autoStart: z.boolean().default(true).describe("Start process automatically on boot"),
  stdoutPatternVars: z
    .record(z.string())
    .optional()
    .describe("Map of variable names to regex patterns to extract from stdout/stderr"),
  readyVars: z
    .array(z.string())
    .optional()
    .describe("Variables that must be present before the process is considered ready"),
  env: z.record(z.string()).optional().describe("Environment variables"),
  envFile: z.string().optional().describe("Path to .env file to load (relative to config file)"),
  restartPolicy: RestartPolicySchema.describe("Restart policy: always (restart on any exit), onFailure (restart on non-zero exit), never (don't restart)"),
  maxRestarts: z.number().default(5).describe("Max restart attempts before giving up (resets after stable period)"),
  healthCheck: z.string().optional().describe("HTTP path for health check"),
  dependsOn: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Wait for one or more processes to be ready before starting"),
  description: z.string().optional().describe("Description shown in session context to help LLM understand the service"),
});

export type ProcessConfig = z.infer<typeof ProcessConfigSchema>;

// Reserved tab names that cannot be used
const RESERVED_TAB_NAMES = ["__welcome__", "mide"];

// Validate tab name: no reserved names, no special tmux chars
export function validateTabName(name: string): { valid: boolean; error?: string } {
  if (RESERVED_TAB_NAMES.includes(name)) {
    return { valid: false, error: `"${name}" is a reserved name` };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { valid: false, error: `"${name}" contains invalid characters (use only alphanumeric, dash, underscore)` };
  }
  return { valid: true };
}

// Layout tab pane config: string (command=name) or object {name, command}
export const DashboardPaneSchema = z.union([
  z.string().describe("Command to run (name defaults to command)"),
  z.object({
    name: z.string().describe("Pane name"),
    command: z.string().describe("Command to run"),
  }),
]);

export type DashboardPane = z.infer<typeof DashboardPaneSchema>;

// Dashboard row: array of panes that will be arranged as columns
export const DashboardRowSchema = z.array(DashboardPaneSchema);

export type DashboardRow = z.infer<typeof DashboardRowSchema>;

// Dashboard config: array of panes (flat) or rows (nested)
// Flat: [a, b, c] -> tiled layout
// Nested: [[a, b], [c, d]] -> rows of columns (2x2 grid)
export const DashboardSchema = z.array(
  z.union([DashboardPaneSchema, DashboardRowSchema])
);

export type Dashboard = z.infer<typeof DashboardSchema>;

// Helper to normalize dashboard pane to {name, command}
export function normalizeDashboardPane(pane: DashboardPane): { name: string; command: string } {
  if (typeof pane === "string") {
    // Extract name from command (first word or full string if simple)
    const name = pane.split(/\s+/)[0] || pane;
    return { name, command: pane };
  }
  return pane;
}

// Tab config: string (command), array (layout), or object (service with options)
export const TabConfigSchema = z.union([
  z.string().describe("Command to run (single pane service)"),
  DashboardSchema.describe("Layout array (multi-pane tab)"),
  ProcessConfigSchema.describe("Service with options"),
]);

export type TabConfig = z.infer<typeof TabConfigSchema>;

// Tabs config: named tabs with their configurations
export const TabsSchema = z.record(z.string(), TabConfigSchema);

export type TabsConfig = z.infer<typeof TabsSchema>;

// Helper to determine tab type from config
export function getTabType(config: TabConfig): "service" | "layout" {
  if (typeof config === "string") return "service";
  if (Array.isArray(config)) return "layout";
  return "service"; // object with command
}

// Helper to normalize tab config to service format
export function normalizeTabToService(name: string, config: TabConfig): ProcessConfig | null {
  if (typeof config === "string") {
    return { command: config, restartPolicy: "onFailure", maxRestarts: 5, autoStart: true, force: false };
  }
  if (Array.isArray(config)) {
    return null; // Layout tab, not a service
  }
  return config; // Already a ProcessConfig
}

// Helper to check if dashboard has nested rows
export function isDashboardNested(dashboard: Dashboard): boolean {
  return dashboard.some((item) => Array.isArray(item));
}

// Helper to normalize dashboard to rows format
// Flat: [a, b, c] -> [[a, b, c]] (single row)
// Nested: [[a, b], [c, d]] -> [[a, b], [c, d]] (already rows)
export function normalizeDashboardToRows(dashboard: Dashboard): DashboardRow[] {
  if (!isDashboardNested(dashboard)) {
    // Flat array: treat all as single row (will use tiled layout)
    return [dashboard as DashboardPane[]];
  }
  // Nested: return as rows
  return dashboard.map((item) =>
    Array.isArray(item) ? item : [item]
  ) as DashboardRow[];
}

// Split direction for embedded pane (when Claude runs inside tmux)
// "auto" = smart detection based on pane dimensions (split along longer axis)
export const SplitDirectionSchema = z.enum(["auto", "right", "left", "top", "bottom"]).default("auto");

export type SplitDirection = z.infer<typeof SplitDirectionSchema>;


// Schema for configurable settings
export const SettingsSchema = z.object({
  logBufferSize: z
    .number()
    .min(100)
    .max(100000)
    .default(1000)
    .describe("Number of log lines to keep per process (default: 1000)"),
  healthCheckInterval: z
    .number()
    .min(1000)
    .max(300000)
    .default(10000)
    .describe("Health check interval in milliseconds (default: 10000)"),
  dependencyTimeout: z
    .number()
    .min(1000)
    .max(600000)
    .default(60000)
    .describe("Timeout for waiting on dependencies in milliseconds (default: 60000)"),
  restartBackoffMax: z
    .number()
    .min(1000)
    .max(300000)
    .default(30000)
    .describe("Maximum restart backoff time in milliseconds (default: 30000)"),
  processStopTimeout: z
    .number()
    .min(1000)
    .max(60000)
    .default(5000)
    .describe("Timeout for graceful process stop in milliseconds (default: 5000)"),
  // Tmux settings
  tmuxSessionPrefix: z
    .string()
    .default("mide")
    .describe("Prefix for tmux session names (default: mide)"),
  // Split direction when running inside tmux
  splitDirection: SplitDirectionSchema
    .describe("Direction to split pane: auto, right, left, top, bottom (default: auto)"),
  // Custom session name (supports env vars: $VAR or ${VAR})
  sessionName: z
    .string()
    .optional()
    .describe("Custom session name (supports $ENV_VAR). Overrides auto-detection from directory name."),
  // Hot-reload setting
  hotReload: z
    .boolean()
    .default(true)
    .describe("Enable automatic config reload when mide.yaml changes (default: true)"),
});

export type Settings = z.infer<typeof SettingsSchema>;

// Schema for the full config file
export const ConfigSchema = z.object({
  // Tabs: unified config for all named tabs (services and layouts)
  tabs: TabsSchema.optional().describe("Named tabs. String = service command, array = layout panes, object = service with options."),
  // Full settings
  settings: SettingsSchema.optional().describe("Global settings for the IDE"),
  // Legacy keys (kept for backward compatibility)
  services: z.record(ProcessConfigSchema).optional().describe("Legacy: service definitions (use tabs instead)"),
  processes: z.record(ProcessConfigSchema).optional().describe("Legacy: process definitions (use tabs instead)"),
}).superRefine((data, ctx) => {
  const tabs =
    (data.tabs && Object.keys(data.tabs).length > 0) ? data.tabs :
    (data.services && Object.keys(data.services).length > 0) ? data.services :
    (data.processes && Object.keys(data.processes).length > 0) ? data.processes :
    undefined;

  if (!tabs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one tab must be defined in 'tabs' (or legacy 'services'/'processes')",
    });
    return;
  }

  for (const name of Object.keys(tabs)) {
    const result = validateTabName(name);
    if (!result.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid tab name: ${result.error}`,
      });
      return;
    }
  }
}).transform((data) => {
  const tabs =
    (data.tabs && Object.keys(data.tabs).length > 0) ? data.tabs :
    (data.services && Object.keys(data.services).length > 0) ? data.services :
    (data.processes && Object.keys(data.processes).length > 0) ? data.processes :
    {};

  return {
    tabs,
    settings: data.settings,
  };
});

export type Config = z.infer<typeof ConfigSchema>;

// Resolved process config with computed values
export interface ResolvedProcessConfig extends Omit<ProcessConfig, 'dependsOn'> {
  name: string;
  resolvedCwd: string;
  allocatedPort?: number;
  // Normalized to always be an array (or undefined)
  dependsOn?: string[];
}

const CONFIG_FILENAMES = ["mide.yaml", "mide.yml"];

/**
 * Check if a config file exists in the current working directory
 */
export function configExists(): boolean {
  const cwd = process.cwd();
  for (const filename of CONFIG_FILENAMES) {
    if (fs.existsSync(path.join(cwd, filename))) {
      return true;
    }
  }
  return false;
}

/**
 * Find and load config file from the current working directory or specified path
 */
export async function loadConfig(configPath?: string): Promise<{ config: Config; configDir: string }> {
  let resolvedPath: string | undefined;
  let configDir: string;

  if (configPath) {
    resolvedPath = path.resolve(configPath);
    configDir = path.dirname(resolvedPath);
  } else {
    // Search for config file in cwd
    const cwd = process.cwd();
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(cwd, filename);
      if (fs.existsSync(candidate)) {
        resolvedPath = candidate;
        configDir = cwd;
        break;
      }
    }
    if (!resolvedPath) {
      throw new Error(
        `Config file not found. Create one of: ${CONFIG_FILENAMES.join(", ")} in ${cwd}`
      );
    }
    configDir = path.dirname(resolvedPath);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(content);
  const config = ConfigSchema.parse(parsed);

  return { config, configDir };
}

/**
 * Normalize dependsOn to always be an array (or undefined)
 */
function normalizeDependsOn(dependsOn: string | string[] | undefined): string[] | undefined {
  if (!dependsOn) return undefined;
  if (Array.isArray(dependsOn)) return dependsOn.length > 0 ? dependsOn : undefined;
  return [dependsOn];
}

/**
 * Resolve service tabs (string or object) to ResolvedProcessConfig
 * Layout tabs (arrays) are skipped
 */
export function resolveProcessConfigs(
  config: Config,
  configDir: string
): ResolvedProcessConfig[] {
  const resolved: ResolvedProcessConfig[] = [];

  if (!config.tabs) return resolved;

  for (const [name, tabConfig] of Object.entries(config.tabs)) {
    // Skip layout tabs (arrays)
    if (getTabType(tabConfig) === "layout") continue;

    // Normalize to ProcessConfig
    const processConfig = normalizeTabToService(name, tabConfig);
    if (!processConfig) continue;

    const resolvedCwd = processConfig.cwd
      ? path.resolve(configDir, processConfig.cwd)
      : configDir;

    resolved.push({
      ...processConfig,
      name,
      resolvedCwd,
      // Normalize dependsOn to array format
      dependsOn: normalizeDependsOn(processConfig.dependsOn),
    });
  }

  // Validate dependencies exist
  const processNames = new Set(resolved.map((p) => p.name));
  for (const process of resolved) {
    const deps = process.dependsOn;
    if (deps) {
      for (const dep of deps) {
        if (!processNames.has(dep)) {
          throw new Error(
            `Process "${process.name}" depends on "${dep}" which does not exist`
          );
        }
      }
    }
  }

  return resolved;
}

/**
 * Topological sort processes by dependencies
 * Supports multiple dependencies per process
 */
export function sortByDependencies(processes: ResolvedProcessConfig[]): ResolvedProcessConfig[] {
  const sorted: ResolvedProcessConfig[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const processMap = new Map(processes.map((p) => [p.name, p]));

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected involving "${name}"`);
    }

    visiting.add(name);
    const process = processMap.get(name);
    if (!process) return;

    // Visit all dependencies
    if (process.dependsOn) {
      for (const dep of process.dependsOn) {
        visit(dep);
      }
    }

    visiting.delete(name);
    visited.add(name);
    sorted.push(process);
  }

  for (const process of processes) {
    visit(process.name);
  }

  return sorted;
}

/**
 * Expand environment variables in a string
 * Supports $VAR and ${VAR} syntax
 */
export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, unbraced) => {
    const varName = braced || unbraced;
    return process.env[varName] || "";
  });
}

/**
 * Deep compare two Tabs configs
 */
export function tabsEqual(a: TabsConfig | undefined, b: TabsConfig | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([ka], [kb]) => ka.localeCompare(kb));
      const result: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        result[k] = normalize(v);
      }
      return result;
    }
    return value;
  };

  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * Get layout tabs from config (tabs that are arrays)
 */
export function getLayoutTabs(config: Config): [string, Dashboard][] {
  if (!config.tabs) return [];
  return Object.entries(config.tabs)
    .filter(([, tabConfig]) => getTabType(tabConfig) === "layout")
    .map(([name, tabConfig]) => [name, tabConfig as Dashboard]);
}

/**
 * Get service tabs from config (tabs that are string or object with command)
 */
export function getServiceTabs(config: Config): [string, TabConfig][] {
  if (!config.tabs) return [];
  return Object.entries(config.tabs)
    .filter(([, tabConfig]) => getTabType(tabConfig) === "service");
}
