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

// Simple layout presets
export const SimpleLayoutSchema = z.enum([
  "horizontal",   // Processes side by side (even-horizontal)
  "vertical",     // Processes stacked (even-vertical)
  "grid",         // Automatic grid layout (tiled)
  "main-left",    // First process large on left, others stacked right (main-vertical)
  "main-top",     // First process large on top, others below (main-horizontal)
]);

export type SimpleLayout = z.infer<typeof SimpleLayoutSchema>;

// Grouped layout with explicit process arrangement using named groups
export const GroupedLayoutSchema = z.object({
  type: z.enum(["rows", "columns"]).describe("Arrange groups as rows (top to bottom) or columns (left to right)"),
  groups: z.record(z.string(), z.array(z.string())).describe("Named groups of processes: { servers: [frontend, backend], tools: [worker] }"),
});

export type GroupedLayout = z.infer<typeof GroupedLayoutSchema>;

// Combined layout type: simple string or grouped object
export const LayoutSchema = z.union([SimpleLayoutSchema, GroupedLayoutSchema]).default("grid");

export type Layout = z.infer<typeof LayoutSchema>;

// Map simple layout names to tmux layout names
export const LAYOUT_TO_TMUX: Record<SimpleLayout, string> = {
  "horizontal": "even-horizontal",
  "vertical": "even-vertical",
  "grid": "tiled",
  "main-left": "main-vertical",
  "main-top": "main-horizontal",
};

// Helper to check if layout is grouped
export function isGroupedLayout(layout: Layout): layout is GroupedLayout {
  return typeof layout === "object" && "type" in layout && "groups" in layout;
}

// Get ordered group names from a grouped layout
export function getGroupNames(layout: GroupedLayout): string[] {
  return Object.keys(layout.groups);
}

// Get group entries in order: [groupName, processes[]]
export function getGroupEntries(layout: GroupedLayout): [string, string[]][] {
  return Object.entries(layout.groups);
}

// Terminal app types (warp not supported - falls back to terminal)
export const TerminalAppSchema = z.enum([
  "auto",
  "tmux",      // Use tmux window if inside tmux, otherwise print attach command
  "ghostty",
  "iterm",
  "kitty",
  "terminal",
]).default("auto");

export type TerminalApp = z.infer<typeof TerminalAppSchema>;


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
  layout: LayoutSchema
    .describe("Pane layout: horizontal, vertical, grid, main-left, main-top (default: grid)"),
  tmuxSessionPrefix: z
    .string()
    .default("mide")
    .describe("Prefix for tmux session names (default: mide)"),
  // Auto-attach terminal
  autoAttachTerminal: z
    .boolean()
    .default(false)
    .describe("Auto-open terminal attached to tmux session"),
  // Terminal app preference
  terminalApp: TerminalAppSchema
    .describe("Terminal app to use: auto (detect), ghostty, iterm, kitty, warp, terminal"),
  // Tmux mode for when running inside tmux
  tmuxMode: z
    .enum(["embedded", "standalone"])
    .optional()
    .describe("Tmux mode: embedded (panes in current session) or standalone (separate IDE session)"),
  // Custom session name (supports env vars: $VAR or ${VAR})
  sessionName: z
    .string()
    .optional()
    .describe("Custom session name (supports $ENV_VAR). Overrides auto-detection from directory name."),
});

export type Settings = z.infer<typeof SettingsSchema>;

// Schema for the full config file
// Supports both "services" (preferred) and "processes" (legacy) keys
export const ConfigSchema = z.object({
  // Top-level shortcuts
  layout: LayoutSchema.optional().describe("Pane layout shorthand (overrides settings.layout)"),
  // Full settings
  settings: SettingsSchema.optional().describe("Global settings for the IDE"),
  // Services (preferred) or processes (legacy alias)
  services: z.record(ProcessConfigSchema).optional(),
  processes: z.record(ProcessConfigSchema).optional(),
}).refine(
  (data) => data.services || data.processes,
  { message: "Either 'services' or 'processes' must be defined" }
).transform((data) => ({
  ...data,
  // Normalize: use services if present, otherwise use processes
  services: data.services || data.processes || {},
  // Keep processes for backward compat but services takes precedence
  processes: data.services || data.processes || {},
}));

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
 * Resolve service configs with absolute paths and validate dependencies
 */
export function resolveProcessConfigs(
  config: Config,
  configDir: string
): ResolvedProcessConfig[] {
  const resolved: ResolvedProcessConfig[] = [];

  for (const [name, processConfig] of Object.entries(config.services)) {
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
