#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as path from "path";
import { existsSync, readFileSync } from "fs";
import { loadConfig, configExists, expandEnvVars } from "./config.js";
import { ProcessManager } from "./process-manager.js";
import { TmuxManager, EmbeddedTmuxManager, isTmuxAvailable, listIdeSessions, isInsideTmux, getServiceLogPath, getEventsFilePath, getSessionLogDir, cleanupStaleSession } from "./tmux-manager.js";
import { InteractionManager, type InteractionResult } from "./interaction-manager.js";
import { emitReloadEvent, readEvents } from "./events.js";
import { FileWatcher } from "./file-watcher.js";

type Command = "server" | "sessions" | "connect" | "help" | "cli-tool" | "down" | "gc" | "up";

// CLI command definitions - maps CLI aliases to tool names and arg parsers
const CLI_COMMANDS: Record<string, {
  tool: string;
  usage: string;
  parseArgs: (args: string[]) => Record<string, unknown> | null;
}> = {
  ls: {
    tool: "list_tabs",
    usage: "mcp-ide ls",
    parseArgs: () => ({}),
  },
  start: {
    tool: "manage_service",
    usage: "mcp-ide start <service>",
    parseArgs: (args) => args[1] ? { name: args[1], op: "start" } : null,
  },
  stop: {
    tool: "manage_service",
    usage: "mcp-ide stop <service>",
    parseArgs: (args) => args[1] ? { name: args[1], op: "stop" } : null,
  },
  restart: {
    tool: "manage_service",
    usage: "mcp-ide restart <service>",
    parseArgs: (args) => args[1] ? { name: args[1], op: "restart" } : null,
  },
  pane: {
    tool: "create_pane",
    usage: "mcp-ide pane <name> <command>",
    parseArgs: (args) => args[1] && args[2] ? { name: args[1], command: args.slice(2).join(" ") } : null,
  },
  rm: {
    tool: "remove_pane",
    usage: "mcp-ide rm <name>",
    parseArgs: (args) => args[1] ? { name: args[1] } : null,
  },
  reload: {
    tool: "reload_config",
    usage: "mcp-ide reload",
    parseArgs: () => ({}),
  },
  // Unified run command: ink files OR shell commands
  // Usage:
  //   mcp-ide run form.tsx              # Ink component (blocks)
  //   mcp-ide run form.tsx --arg key=val  # Ink with args
  //   mcp-ide run -- npm test           # Shell command (non-blocking)
  //   mcp-ide run --wait -- npm test    # Shell command (blocking)
  run: {
    tool: "run_interaction",
    usage: "mcp-ide run [--wait] [file.tsx [--arg k=v]] | mcp-ide run [--wait] -- <command>",
    parseArgs: (args) => {
      if (args.length < 2) return null;

      // Check for --wait flag
      let waitFlag = false;
      let restArgs = args.slice(1);
      if (restArgs[0] === "--wait") {
        waitFlag = true;
        restArgs = restArgs.slice(1);
      }

      // Check for -- separator (shell command mode)
      const separatorIdx = restArgs.indexOf("--");
      if (separatorIdx !== -1) {
        // Shell command mode: everything after -- is the command
        const command = restArgs.slice(separatorIdx + 1).join(" ");
        if (!command) return null;
        // timeout_ms: 0 = non-blocking, 300000 = blocking (5 min)
        return { command, timeout_ms: waitFlag ? 300000 : 0 };
      }

      // Ink file mode: first arg is the file
      if (!restArgs[0]) return null;
      const inkFile = restArgs[0];

      // Must be a .tsx or .jsx file
      if (!inkFile.endsWith(".tsx") && !inkFile.endsWith(".jsx")) {
        console.error("Error: File must be .tsx or .jsx, or use -- for shell commands");
        return null;
      }

      // Parse --arg key=value pairs
      const inkArgs: Record<string, string> = {};
      for (let i = 1; i < restArgs.length; i++) {
        if (restArgs[i] === "--arg" && restArgs[i + 1]) {
          const [key, ...valueParts] = restArgs[i + 1].split("=");
          if (key) {
            inkArgs[key] = valueParts.join("=");
          }
          i++; // Skip the value
        }
      }

      // Ink always blocks
      return { ink_file: inkFile, ink_args: Object.keys(inkArgs).length > 0 ? inkArgs : undefined, timeout_ms: 300000 };
    },
  },
  send: {
    tool: "send_keys",
    usage: "mcp-ide send <pane> <keys>",
    parseArgs: (args) => {
      if (!args[1] || !args[2]) return null;
      return { name: args[1], keys: args.slice(2).join(" ") };
    },
  },
};

interface ParsedArgs {
  command: Command;
  config?: string;
  sessionName?: string;
  paneName?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  // up command options
  detach?: boolean;      // -d: return immediately after starting
  jsonOutput?: boolean;  // --json: output as JSONL for agents (no TTY)
}

/**
 * Load config and create TmuxManager - reusable helper to avoid duplication
 */
async function loadConfigAndTmux(configPath?: string): Promise<{
  config: Awaited<ReturnType<typeof loadConfig>>;
  tmux: TmuxManager;
  sessionName: string;
}> {
  const loaded = await loadConfig(configPath);
  const defaultName = path.basename(loaded.configDir);
  const sessionName = loaded.config.settings?.sessionName
    ? expandEnvVars(loaded.config.settings.sessionName)
    : defaultName;
  const tmux = new TmuxManager(sessionName, {
    sessionPrefix: loaded.config.settings?.tmuxSessionPrefix,
  });
  return { config: loaded, tmux, sessionName };
}

// Parse CLI arguments
function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let config: string | undefined;
  const firstArg = args[0];

  if (!firstArg || firstArg.startsWith("-")) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--help" || arg === "-h") return { command: "help" };
      if (arg === "--config" || arg === "-c") {
        config = args[++i];
        if (!config) { console.error("Error: --config requires a path"); process.exit(1); }
      }
    }
    return { command: "server", config };
  }

  // Built-in commands
  if (firstArg === "server") return { command: "server", config };
  if (firstArg === "sessions") return { command: "sessions" };
  // up: start services, wait for ready, return status (with -d for detached, --json for agent mode)
  if (firstArg === "up") {
    let detach = false;
    let jsonOutput = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "-d" || args[i] === "--detach") detach = true;
      else if (args[i] === "--json") jsonOutput = true;
    }
    return { command: "up", detach, jsonOutput };
  }
  // connect/attach: create session if needed, attach to tmux (TTY mode)
  if (firstArg === "connect" || firstArg === "attach") {
    return { command: "connect", sessionName: args[1], paneName: args[2] };
  }
  if (firstArg === "down") return { command: "down" };
  if (firstArg === "gc") return { command: "gc" };
  if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") return { command: "help" };

  // CLI tool commands
  const cliCmd = CLI_COMMANDS[firstArg];
  if (cliCmd) {
    const toolArgs = cliCmd.parseArgs(args);
    if (toolArgs === null) {
      console.error(`Usage: ${cliCmd.usage}`);
      process.exit(1);
    }
    return { command: "cli-tool", toolName: cliCmd.tool, toolArgs };
  }

  // Unknown command
  if (firstArg.startsWith("-")) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--help" || args[i] === "-h") return { command: "help" };
      if (args[i] === "--config" || args[i] === "-c") config = args[++i];
    }
    return { command: "server", config };
  }

  console.error(`Unknown command: ${firstArg}`);
  console.error("Run 'mcp-ide help' for usage");
  process.exit(1);
}

function showHelp(): void {
  // Generate CLI commands help from CLI_COMMANDS
  const cliCmdsHelp = Object.entries(CLI_COMMANDS)
    .map(([, def]) => `  ${def.usage}`)
    .join("\n");

  console.log(`
mcp-ide - Interactive Development Environment for Claude Code

Usage:
  mcp-ide up [-d] [--json]    Start services, wait for ready, return status
  mcp-ide connect [session]   Attach to session (create if needed)
  mcp-ide down                Stop session and tabs
  mcp-ide sessions            List active sessions

Up Options:
  -d, --detach            Return immediately after starting (don't wait)
  --json                  Output as JSON (for agents/scripts)

Aliases:
  mcp-ide attach              Same as connect

CLI Commands:
${cliCmdsHelp}

Options:
  -h, --help              Show this help message
  -c, --config <path>     Path to mide.yaml config file

Configuration:
  Create an mide.yaml file in your project root to define tabs.

Example mide.yaml:
  tabs:
    api: npm run dev            # String = service tab
    frontend:                   # Object = service with options
      command: npm run dev
      port: 3000
    dashboard:                  # Array = layout tab with panes
      - [htop, "watch date"]

Agent Usage:
  # Start and stream events (for AI agents)
  mcp-ide up --json

  # Start detached and poll events file
  mcp-ide up -d --json
  tail -f /tmp/mide-<session>/events.jsonl
`);
}

/**
 * List all active IDE sessions
 */
async function commandSessions(): Promise<void> {
  const sessions = await listIdeSessions();

  if (sessions.length === 0) {
    console.log("No active IDE sessions found.");
    console.log("\nStart a session by running 'mcp-ide' in a project directory with mide.yaml");
    return;
  }

  console.log("IDE SESSIONS");
  console.log("============");
  console.log("");

  for (const session of sessions) {
    const age = formatAge(session.created);
    const status = session.isStale ? "[STALE]" : "[ACTIVE]";
    const clientInfo = session.clients > 0 ? `${session.clients} client(s)` : "no clients";
    const pidInfo = session.ownerPid ? `PID ${session.ownerPid}` : "no owner";
    console.log(`  ${session.name.padEnd(25)} ${session.windows} win  ${age.padEnd(4)}  ${status.padEnd(8)}  ${clientInfo.padEnd(12)}  ${pidInfo}`);
  }

  console.log("");
  console.log("Use: mcp-ide connect <name>");
  console.log("Use: mcp-ide gc          (clean up stale sessions)");
}

function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Execute a CLI tool command and return the result as a string
 */
async function executeCLITool(
  toolName: string,
  args: Record<string, unknown>,
  processManager?: ProcessManager,
  tmuxManager?: TmuxManager
): Promise<string> {
  switch (toolName) {
    case "list_tabs": {
      if (!processManager || !tmuxManager) return "No tabs configured";
      const tabs = processManager.listTabs();
      if (tabs.length === 0) return "No tabs defined";
      const sessionName = tmuxManager.sessionName;
      const lines = tabs.map(t => {
        const parts = [`${t.name}: ${t.type}`];
        if (t.type === "service") {
          parts.push(t.status ?? "unknown");
          if (t.port) parts.push(`port=${t.port}`);
          if (t.healthy !== undefined) parts.push(`healthy=${t.healthy}`);
          parts.push(`log=${getServiceLogPath(sessionName, t.name)}`);
        }
        parts.push(`window=${t.windowIndex}`);
        return parts.join(" | ");
      });
      lines.push(`\nEvents: ${getEventsFilePath(sessionName)}`);
      return lines.join("\n");
    }

    case "manage_service": {
      if (!processManager) return "No tabs configured";
      const { name, op } = args as { name: string; op: string };
      // Reject operations on layout tabs
      if (processManager.isLayoutTab(name)) {
        return `Error: "${name}" is a layout tab - cannot start/stop/restart`;
      }
      switch (op) {
        case "start":
          await processManager.startProcess(name);
          return `Started ${name}`;
        case "stop":
          await processManager.stopProcess(name);
          return `Stopped ${name}`;
        case "restart":
          await processManager.restartProcess(name);
          return `Restarted ${name}`;
        default:
          return `Unknown operation: ${op}`;
      }
    }

    case "create_pane": {
      if (!processManager || !tmuxManager) return "No session active";
      const { name, command, group } = args as { name: string; command: string; group?: string };
      const terminal = await processManager.createDynamicTerminal(name, command, group);
      return `Created pane "${terminal.name}" (${terminal.paneId})`;
    }

    case "remove_pane": {
      if (!processManager) return "No session active";
      const { name } = args as { name: string };
      await processManager.removeDynamicTerminal(name);
      return `Removed pane "${name}"`;
    }

    case "send_keys": {
      if (!tmuxManager) return "No session active";
      const { name, keys } = args as { name: string; keys: string };
      await tmuxManager.sendKeys(name, keys);
      return `Sent keys to "${name}"`;
    }

    case "run_interaction": {
      // Run interaction in tmux pane via InteractionManager
      const { schema, ink_file, ink_args, command, title, timeout_ms } = args as {
        schema?: unknown;
        ink_file?: string;
        ink_args?: Record<string, unknown>;
        command?: string;
        title?: string;
        timeout_ms?: number;
      };

      // Determine which tmux session to use for the interaction
      let effectiveTmuxManager: TmuxManager | EmbeddedTmuxManager | undefined = tmuxManager;

      if (isInsideTmux() && !tmuxManager) {
        // Inside tmux but no mide session passed - check if mide session exists
        if (configExists()) {
          try {
            const { tmux: mideTmux } = await loadConfigAndTmux();
            if (await mideTmux.sessionExists()) {
              effectiveTmuxManager = mideTmux;
              console.error(`[mide] Using mide session: ${mideTmux.sessionName}`);
            }
          } catch {
            // Fall through to embedded mode
          }
        }

        // Fallback to embedded mode if no mide session
        if (!effectiveTmuxManager) {
          try {
            effectiveTmuxManager = await EmbeddedTmuxManager.create();
            console.error(`[mide] Running in embedded mode (session: ${effectiveTmuxManager.getSessionName()})`);
          } catch (err) {
            console.error(`[mide] Failed to create embedded manager: ${err}`);
          }
        }
      }

      if (!effectiveTmuxManager) {
        return "No active session - cannot run interaction";
      }

      // Create InteractionManager for this session
      const sessionName = tmuxManager?.sessionName;
      const interactionMgr = new InteractionManager({
        tmuxManager: effectiveTmuxManager,
        cwd: process.cwd(),
        sessionName,
      });

      // Create the interaction
      const interactionId = await interactionMgr.create({
        schema: schema as import("@mcp-ide/shared").FormSchema | undefined,
        inkFile: ink_file,
        inkArgs: ink_args,
        command,
        title,
        timeoutMs: timeout_ms,
      });

      // Non-blocking mode: timeout_ms === 0
      if (timeout_ms === 0) {
        return JSON.stringify({ interaction_id: interactionId, status: "started" });
      }

      // Blocking mode: wait for result
      console.error(`[mide] Waiting for interaction in tmux pane...`);
      return new Promise<string>((resolve) => {
        interactionMgr.on("interactionComplete", (id: string, result: InteractionResult) => {
          if (id === interactionId) {
            resolve(JSON.stringify(result, null, 2));
          }
        });
      });
    }

    case "reload_config": {
      if (!processManager || !tmuxManager) return "No active session";
      const newLoaded = await loadConfig();
      const result = await processManager.reload(newLoaded.config);

      // Emit reload event
      emitReloadEvent(
        tmuxManager.sessionName,
        result.added,
        result.removed,
        result.changed,
        result.tabsReloaded
      );

      const lines = ["Reload complete:"];
      if (result.added.length > 0) lines.push(`  Added: ${result.added.join(", ")}`);
      if (result.removed.length > 0) lines.push(`  Removed: ${result.removed.join(", ")}`);
      if (result.changed.length > 0) lines.push(`  Changed: ${result.changed.join(", ")}`);
      if (result.tabsReloaded) lines.push(`  Tabs: reloaded`);
      if (lines.length === 1) lines.push("  No changes detected");

      return lines.join("\n");
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// Service tool schemas
const ManageServiceSchema = z.object({
  name: z.string().describe("Service name from mide.yaml"),
  op: z.enum(["start", "stop", "restart"]).describe("Operation to perform"),
  args: z.string().optional().describe("Additional arguments (for start)"),
  force: z.boolean().optional().describe("Kill any process using the port (for start)"),
});

// Pane tool schemas
const CreatePaneSchema = z.object({
  name: z.string().describe("Unique name for the pane"),
  command: z.string().describe("Command to run in the pane"),
  group: z.string().optional().describe("Group to place the pane in (default: 'dynamic')"),
});

const RemovePaneSchema = z.object({
  name: z.string().describe("Name of the pane to remove"),
});


// Interaction tool schemas
const FormQuestionSchema = z.object({
  question: z.string().describe("The question to ask"),
  header: z.string().describe("Short label for the question (max 12 chars)"),
  options: z.array(z.object({
    label: z.string().describe("Option label"),
    description: z.string().optional().describe("Option description"),
  })).optional().describe("Options for selection (if not provided, renders text input)"),
  multiSelect: z.boolean().optional().describe("Allow multiple selections"),
  inputType: z.enum(["text", "textarea", "password"]).optional().describe("Input type for text questions"),
  placeholder: z.string().optional().describe("Placeholder text for input"),
  validation: z.string().optional().describe("Regex pattern for validation"),
});

const FormSchemaSchema = z.object({
  questions: z.array(FormQuestionSchema).min(1).describe("Questions to ask"),
});

const RunInteractionSchema = z.object({
  schema: FormSchemaSchema.optional().describe("Form schema (AskUserQuestion-compatible)"),
  ink_file: z.string().optional().describe("Path to custom Ink component file (.tsx/.jsx)"),
  ink_args: z.record(z.unknown()).optional().describe("Arguments to pass to Ink component"),
  command: z.string().optional().describe("Shell command to run (alternative to ink_file/schema)"),
  title: z.string().optional().describe("Title for the interaction"),
  timeout_ms: z.number().optional().describe("Timeout in ms (0 = non-blocking)"),
});


// Test blocking tool schema (for internal testing)
const TestBlockingSchema = z.object({
  duration_seconds: z.number().describe("How long to block in seconds"),
  heartbeat_interval_ms: z.number().optional().describe("Progress heartbeat interval in ms (default: 25000)"),
});

// MCP Tools - 7 tools
const MCP_TOOLS: Tool[] = [
  // Tab tools (require mide.yaml)
  {
    name: "list_tabs",
    description: "List all tabs from mide.yaml with type (service/layout), status, port, and health",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "manage_service",
    description: "Start, stop, or restart a service tab defined in mide.yaml",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Service name from mide.yaml" },
        op: { type: "string", enum: ["start", "stop", "restart"], description: "Operation to perform" },
        args: { type: "string", description: "Additional arguments (for start)" },
        force: { type: "boolean", description: "Kill any process using the port (for start)" },
      },
      required: ["name", "op"],
    },
  },
  // Pane tools
  {
    name: "create_pane",
    description: "Create a terminal pane running a command",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique name for the pane" },
        command: { type: "string", description: "Command to run (e.g., 'npm run dev')" },
        group: { type: "string", description: "Layout group (standalone mode only)" },
      },
      required: ["name", "command"],
    },
  },
  {
    name: "run_interaction",
    description: "Run an interactive component, form, or shell command in the Canvas (window 0). Blocks until completion.",
    inputSchema: {
      type: "object",
      properties: {
        schema: {
          type: "object",
          description: "Form schema with questions",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  header: { type: "string" },
                  options: { type: "array" },
                  multiSelect: { type: "boolean" },
                  inputType: { type: "string", enum: ["text", "textarea", "password"] },
                },
                required: ["question", "header"],
              },
            },
          },
        },
        ink_file: { type: "string", description: "Path to Ink component (.tsx/.jsx) - resolves from .mide/interactive/" },
        ink_args: { type: "object", description: "Arguments to pass to the Ink component" },
        command: { type: "string", description: "Shell command to run (alternative to ink_file/schema)" },
        title: { type: "string", description: "Title for the interaction" },
        timeout_ms: { type: "number", description: "Timeout in ms (0 = non-blocking, returns immediately)" },
      },
    },
  },
  {
    name: "remove_pane",
    description: "Remove a terminal or interaction pane by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the pane to remove" },
      },
      required: ["name"],
    },
  },
  {
    name: "send_keys",
    description: "Send keystrokes to a pane (for interactive control)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the pane" },
        keys: { type: "string", description: "Keys to send (e.g., 'Enter', 'C-c' for Ctrl+C)" },
      },
      required: ["name", "keys"],
    },
  },
  // Config reload tool
  {
    name: "reload_config",
    description: "Reload mide.yaml configuration. Restarts changed service tabs.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

function formatToolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

async function main() {
  const parsedArgs = parseArgs();

  // Handle non-server commands
  switch (parsedArgs.command) {
    case "help":
      showHelp();
      process.exit(0);
      break;

    case "sessions":
      await commandSessions();
      process.exit(0);
      break;

    case "connect": {
      // Connect to session: create if needed, start tabs, attach/embed
      const hasConfig = configExists();
      let connectTmux: TmuxManager;
      let sessionCreated = false;

      if (hasConfig) {
        const { config: connectLoaded, tmux } = await loadConfigAndTmux();
        connectTmux = tmux;

        if (!(await connectTmux.sessionExists())) {
          await connectTmux.createSession();
          console.log(`Created session: ${connectTmux.sessionName}`);
          sessionCreated = true;

          const connectPm = new ProcessManager(connectLoaded.configDir, {
            settings: connectLoaded.config.settings,
            tmuxManager: connectTmux,
          });
          await connectPm.startAll(connectLoaded.config);

          const tabs = connectPm.listProcesses();
          console.log(`Started ${tabs.filter(s => s.status === "running").length}/${tabs.length} service tabs`);
        }
      } else {
        // No config - create empty session based on directory name
        const projectName = path.basename(process.cwd());
        connectTmux = new TmuxManager(projectName);

        if (!(await connectTmux.sessionExists())) {
          await connectTmux.createSession();
          console.log(`Created session: ${connectTmux.sessionName}`);
          console.log(`No mide.yaml - session only (no tabs)`);
          sessionCreated = true;
        }
      }

      // If already inside tmux, create a split pane that attaches to the mide session
      if (isInsideTmux()) {
        const targetSession = connectTmux.sessionName;

        // Get split direction from config (default: auto - smart detection based on pane size)
        let splitDirection: "auto" | "right" | "left" | "top" | "bottom" = "auto";
        if (hasConfig) {
          const { config: loadedConfig } = await loadConfigAndTmux();
          splitDirection = loadedConfig.config.settings?.splitDirection ?? "auto";
        }

        console.log(`Session ${targetSession} ready`);
        console.log(`Creating split pane (direction: ${splitDirection})...`);

        // Create embedded manager for current tmux session
        const embedded = await EmbeddedTmuxManager.create();

        // Create a split pane that attaches to the mide session
        // Use TMUX= to allow nested tmux attachment
        // Select window 0 (dashboard) first
        const attachCmd = `TMUX= tmux select-window -t ${targetSession}:0 2>/dev/null; TMUX= tmux attach -t ${targetSession}`;
        await embedded.createPane("mide-view", attachCmd, process.cwd(), undefined, {
          direction: splitDirection,
          skipRebalance: true,
        });

        console.log(`Opened ${targetSession} in split pane`);
        process.exit(0);
      }

      // Not inside tmux - attach directly
      if (parsedArgs.paneName) {
        console.log(`Attaching to ${connectTmux.sessionName} (pane: ${parsedArgs.paneName})...`);
        await connectTmux.selectPane(parsedArgs.paneName);
      } else if (!sessionCreated) {
        console.log(`Attaching to ${connectTmux.sessionName}...`);
      } else {
        console.log(`Attaching...`);
      }

      const exitCode = await connectTmux.attach();
      process.exit(exitCode);
    }

    case "up": {
      // Start services in background, wait for ready (or -d for detached), return status
      const hasConfig = configExists();
      if (!hasConfig) {
        if (parsedArgs.jsonOutput) {
          console.log(JSON.stringify({ error: "No mide.yaml found" }));
        } else {
          console.error("No mide.yaml found in current directory");
        }
        process.exit(1);
      }

      const { config: upLoaded, tmux: upTmux } = await loadConfigAndTmux();
      const upSessionName = upTmux.sessionName; // Use full session name with prefix
      const sessionAlreadyExists = await upTmux.sessionExists();

      if (!sessionAlreadyExists) {
        await upTmux.createSession();
        if (!parsedArgs.jsonOutput) {
          console.log(`Created session: ${upSessionName}`);
        }
      }

      const upPm = new ProcessManager(upLoaded.configDir, {
        settings: upLoaded.config.settings,
        tmuxManager: upTmux,
      });

      if (!sessionAlreadyExists) {
        await upPm.startAll(upLoaded.config);
      } else {
        // Session exists - just load processes to get status
        await upPm.loadProcesses(upLoaded.config);
      }

      // Helper to format status output
      const formatStatus = () => {
        const tabs = upPm.listTabs();
        const services = tabs.filter(t => t.type === "service");
        const ready = services.filter(s => s.status === "running" || s.status === "ready");

        if (parsedArgs.jsonOutput) {
          return JSON.stringify({
            session: upSessionName,
            status: ready.length === services.length ? "ready" : "starting",
            services: services.map(s => ({
              name: s.name,
              status: s.status ?? "unknown",
              port: s.port,
              healthy: s.healthy,
            })),
            eventsFile: getEventsFilePath(upSessionName),
            logsDir: getSessionLogDir(upSessionName),
          }, null, 2);
        } else {
          const lines = [
            `Session: ${upSessionName}`,
            `Status: ${ready.length}/${services.length} services ready`,
            "",
            "Services:",
          ];
          for (const svc of services) {
            const statusIcon = svc.status === "running" || svc.status === "ready" ? "✓" :
                              svc.status === "starting" ? "⋯" :
                              svc.status === "crashed" ? "✗" : "○";
            const portStr = svc.port ? `:${svc.port}` : "";
            const healthStr = svc.healthy !== undefined ? (svc.healthy ? " [healthy]" : " [unhealthy]") : "";
            lines.push(`  ${statusIcon} ${svc.name}${portStr} - ${svc.status ?? "unknown"}${healthStr}`);
          }
          lines.push("");
          lines.push(`Events: ${getEventsFilePath(upSessionName)}`);
          lines.push(`Logs: ${getSessionLogDir(upSessionName)}`);
          return lines.join("\n");
        }
      };

      // Detached mode: return immediately
      if (parsedArgs.detach) {
        console.log(formatStatus());
        process.exit(0);
      }

      // Default: wait for all services to be ready
      if (!parsedArgs.jsonOutput) {
        console.log("Waiting for services to be ready...");
      }

      // Poll for status until all services are ready (or timeout after 60s)
      const startTime = Date.now();
      const timeout = 60000;

      while (Date.now() - startTime < timeout) {
        const tabs = upPm.listTabs();
        const services = tabs.filter(t => t.type === "service");
        const ready = services.filter(s => s.status === "running" || s.status === "ready");
        const failed = services.filter(s => s.status === "crashed" || s.status === "stopped");

        // All ready or some failed
        if (ready.length + failed.length === services.length) {
          console.log(formatStatus());
          process.exit(failed.length > 0 ? 1 : 0);
        }

        // JSON mode: stream events as they happen
        if (parsedArgs.jsonOutput) {
          const events = readEvents(upSessionName);
          for (const event of events.slice(-5)) { // Last 5 events
            if (event.ts > startTime) {
              console.log(JSON.stringify(event));
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Timeout
      if (parsedArgs.jsonOutput) {
        console.log(JSON.stringify({ error: "timeout", message: "Services did not become ready within 60s" }));
      } else {
        console.error("Timeout: services did not become ready within 60s");
      }
      console.log(formatStatus());
      process.exit(1);
    }

    case "down": {
      // Stop tabs and kill session
      let downTmux: TmuxManager;
      let downSessionName: string;

      if (configExists()) {
        const loaded = await loadConfigAndTmux();
        downTmux = loaded.tmux;
        downSessionName = loaded.sessionName;
      } else {
        // No config - use default session name
        const projectName = path.basename(process.cwd());
        downTmux = new TmuxManager(projectName);
        downSessionName = downTmux.sessionName;
      }

      if (!(await downTmux.sessionExists())) {
        console.log(`No active session for ${downSessionName}`);
        process.exit(0);
      }

      await downTmux.destroySession();
      console.log(`Stopped session: ${downTmux.sessionName}`);
      process.exit(0);
    }

    case "gc": {
      // Clean up stale sessions
      const sessions = await listIdeSessions();
      const staleSessions = sessions.filter(s => s.isStale);

      if (staleSessions.length === 0) {
        console.log("No stale sessions found.");
        process.exit(0);
      }

      console.log(`Found ${staleSessions.length} stale session(s):`);
      for (const session of staleSessions) {
        console.log(`  ${session.name} (${session.windows} windows, owner PID ${session.ownerPid || "unknown"} not running)`);
      }

      for (const session of staleSessions) {
        await cleanupStaleSession(session.name);
        console.log(`Cleaned up: ${session.name}`);
      }

      process.exit(0);
    }

    case "cli-tool": {
      // Execute CLI tool command
      if (!parsedArgs.toolName || !parsedArgs.toolArgs) {
        console.error("Invalid CLI tool invocation");
        process.exit(1);
      }

      // Tools that don't require mide.yaml or active session
      const standaloneTools: string[] = [];
      const isStandalone = standaloneTools.includes(parsedArgs.toolName);

      // Tools that require mide.yaml and tabs
      const tabTools = ["list_tabs", "manage_service"];
      const needsTabs = tabTools.includes(parsedArgs.toolName);

      // Tools that require an active session (but not necessarily tabs)
      // show_user_interaction can work in embedded mode (inside tmux) without mide.yaml
      const sessionTools = ["create_pane", "remove_pane", "send_keys"];
      const embeddableTools = ["show_user_interaction"];  // Can work in embedded mode without config
      const needsSession = sessionTools.includes(parsedArgs.toolName);
      const canUseEmbedded = embeddableTools.includes(parsedArgs.toolName) && isInsideTmux();

      const hasConfig = configExists();
      if (!hasConfig && needsTabs) {
        console.error("No mide.yaml found - cannot determine session. Run from a directory with mide.yaml");
        process.exit(1);
      }
      if (!hasConfig && needsSession && !canUseEmbedded) {
        console.error("No mide.yaml found - cannot determine session. Run from a directory with mide.yaml");
        process.exit(1);
      }

      let cliProcessManager: ProcessManager | undefined;
      let cliTmuxManager: TmuxManager | undefined;

      if (hasConfig && !isStandalone) {
        const { config: cliLoaded, tmux, sessionName } = await loadConfigAndTmux();
        cliTmuxManager = tmux;

        if (!(await cliTmuxManager.sessionExists())) {
          console.error(`No active session for ${sessionName}. Start with: mcp-ide up`);
          process.exit(1);
        }

        cliProcessManager = new ProcessManager(cliLoaded.configDir, {
          settings: cliLoaded.config.settings,
          tmuxManager: cliTmuxManager,
        });

        // Load process definitions to query status (doesn't start them)
        await cliProcessManager.loadProcesses(cliLoaded.config);
      }

      const result = await executeCLITool(
        parsedArgs.toolName,
        parsedArgs.toolArgs,
        cliProcessManager,
        cliTmuxManager
      );
      console.log(result);
      process.exit(0);
    }

    case "server":
      // Continue to MCP server mode below
      break;
  }

  // Server mode: Start MCP server
  const workspaceDir = process.cwd();

  // Check if tmux is available (required)
  if (!(await isTmuxAvailable())) {
    console.error("[mide] Error: Required dependency not found.");
    console.error("[mide] Install: brew install tmux (macOS) or apt install tmux (Linux)");
    process.exit(1);
  }

  // Check if config exists (either specified or in cwd)
  const hasConfig = parsedArgs.config || configExists();
  if (!hasConfig) {
    console.error("[mide] No mide.yaml found in current directory");
    console.error("[mide] Running in minimal mode - no process management available");
  }

  // Load config if it exists
  let config: Awaited<ReturnType<typeof loadConfig>>["config"] | undefined;
  let configDir: string = workspaceDir;
  let processManager: ProcessManager | undefined;
  let tmuxManager: TmuxManager | undefined;
  let embeddedTmuxManager: EmbeddedTmuxManager | undefined;
  let interactionManager: InteractionManager | undefined;
  let fileWatcher: FileWatcher | undefined;

  // Initialize embedded tmux manager if running inside tmux
  if (isInsideTmux()) {
    try {
      embeddedTmuxManager = await EmbeddedTmuxManager.create();
      console.error(`[mide] Running in embedded mode (session: ${embeddedTmuxManager.getSessionName()})`);

      // Initialize interaction manager for embedded mode (works without mide.yaml)
      // Uses ~/.mide/interactive/ for global components
      // Note: sessionName not available for embedded mode (no mide session)
      interactionManager = new InteractionManager({
        tmuxManager: embeddedTmuxManager,
        cwd: workspaceDir,
      });
    } catch (err) {
      console.error(`[mide] Failed to create embedded tmux manager: ${err}`);
    }
  }

  if (hasConfig) {
    const { config: loaded, tmux } = await loadConfigAndTmux(parsedArgs.config);
    config = loaded.config;
    configDir = loaded.configDir;
    tmuxManager = tmux;
    await tmuxManager.createSession();

    console.error(`[mide] Created session: ${tmuxManager.sessionName}`);

    // Initialize process manager with tmux
    processManager = new ProcessManager(configDir, {
      settings: config.settings,
      tmuxManager,
    });
    await processManager.startAll(config);

    // Initialize interaction manager for interactive forms
    // Let InteractionManager find ink-runner relative to its own location
    interactionManager = new InteractionManager({
      tmuxManager,
      cwd: configDir,  // Project root for resolving .mide/interactive paths
      sessionName: tmuxManager.sessionName,
    });

    // Initialize file watcher for hot-reload (if enabled)
    const hotReloadEnabled = config?.settings?.hotReload ?? true;
    if (hotReloadEnabled) {
      // Find the config file to watch
      const configFilePath = existsSync(path.join(configDir, "mide.yaml"))
        ? path.join(configDir, "mide.yaml")
        : path.join(configDir, "mide.yml");

      fileWatcher = new FileWatcher({ configPath: configFilePath });

      fileWatcher.on("configChanged", async () => {
        console.error("[mide] Config file changed, reloading...");
        try {
          const newLoaded = await loadConfig();
          const result = await processManager!.reload(newLoaded.config);

          console.error(`[mide] Reload complete: +${result.added.length} -${result.removed.length} ~${result.changed.length}`);
          if (result.tabsReloaded) {
            console.error("[mide] Dashboard layout updated");
          }

          // Emit reload event
          emitReloadEvent(
            tmuxManager!.sessionName,
            result.added,
            result.removed,
            result.changed,
            result.tabsReloaded
          );
        } catch (err) {
          console.error("[mide] Reload failed:", err);
        }
      });

      fileWatcher.start();
      console.error("[mide] Hot-reload enabled: watching mide.yaml for changes");
    }

  }

  // Tool handler
  async function handleToolCall(name: string, args: Record<string, unknown>) {
    switch (name) {
      case "list_tabs": {
        if (!processManager || !tmuxManager) {
          return formatToolError("No mide.yaml found - tab management not available");
        }
        const tabs = processManager.listTabs();
        if (tabs.length === 0) {
          return {
            content: [{ type: "text", text: "No tabs defined in mide.yaml" }],
          };
        }
        const sessionName = tmuxManager.sessionName;
        const formatted = tabs.map((t) => {
          const parts = [`${t.name}: ${t.type}`];
          if (t.type === "service") {
            const proc = processManager!.getProcess(t.name);
            const state = proc?.getState();
            parts.push(t.status ?? "unknown");
            if (t.port) parts.push(`port=${t.port}`);
            if (state?.url) parts.push(`url=${state.url}`);
            if (t.healthy !== undefined) parts.push(`healthy=${t.healthy}`);
            if (state?.pid) parts.push(`pid=${state.pid}`);
            parts.push(`log=${getServiceLogPath(sessionName, t.name)}`);
          }
          parts.push(`window=${t.windowIndex}`);
          return parts.join(" | ");
        });
        formatted.push(`\nEvents: ${getEventsFilePath(sessionName)}`);
        return {
          content: [{ type: "text", text: formatted.join("\n") }],
        };
      }

      case "manage_service": {
        if (!processManager) {
          return formatToolError("No mide.yaml found - service management not available");
        }
        const parsed = ManageServiceSchema.parse(args);
        // Reject operations on layout tabs
        if (processManager.isLayoutTab(parsed.name)) {
          return formatToolError(`"${parsed.name}" is a layout tab - cannot start/stop/restart`);
        }
        switch (parsed.op) {
          case "start":
            await processManager.startProcess(parsed.name, {
              args: parsed.args,
              force: parsed.force,
            });
            return {
              content: [{ type: "text", text: `Service "${parsed.name}" started` }],
            };
          case "stop":
            await processManager.stopProcess(parsed.name);
            return {
              content: [{ type: "text", text: `Service "${parsed.name}" stopped` }],
            };
          case "restart":
            await processManager.restartProcess(parsed.name);
            return {
              content: [{ type: "text", text: `Service "${parsed.name}" restarted` }],
            };
        }
        break;
      }

      case "create_pane": {
        const parsed = CreatePaneSchema.parse(args);

        // Use embedded mode if inside tmux, otherwise use standalone mide session
        if (isInsideTmux() && embeddedTmuxManager) {
          const paneId = await embeddedTmuxManager.createPane(
            parsed.name,
            parsed.command,
            configDir
          );
          return {
            content: [{
              type: "text",
              text: `Created pane "${parsed.name}"\n` +
                `Command: ${parsed.command}\n` +
                `Pane ID: ${paneId}`
            }],
          };
        }

        // Standalone mode: use separate MIDE session (requires config)
        if (!processManager || !tmuxManager) {
          return formatToolError("Requires mide.yaml or running inside tmux");
        }

        const terminal = await processManager.createDynamicTerminal(
          parsed.name,
          parsed.command,
          parsed.group
        );

        const groups = processManager.getAvailableGroups();
        return {
          content: [{
            type: "text",
            text: `Created pane "${terminal.name}" in group "${terminal.group}"\n` +
              `Command: ${terminal.command}\n` +
              `Pane ID: ${terminal.paneId}\n` +
              (groups.length > 1 ? `Available groups: ${groups.join(", ")}` : "")
          }],
        };
      }

      case "remove_pane": {
        const parsed = RemovePaneSchema.parse(args);

        // Try embedded manager first
        if (embeddedTmuxManager?.hasPane(parsed.name)) {
          await embeddedTmuxManager.killPane(parsed.name);
          return {
            content: [{ type: "text", text: `Removed embedded terminal "${parsed.name}"` }],
          };
        }

        // Fall back to standalone mode
        if (!processManager) {
          return formatToolError("Terminal not found");
        }
        await processManager.removeDynamicTerminal(parsed.name);
        return {
          content: [{ type: "text", text: `Removed pane "${parsed.name}"` }],
        };
      }

      // Removed: capture_pane, get_user_interaction, set_status
      // Claude uses tail -f on log files directly for real-time logs

      case "reload_config": {
        if (!processManager || !tmuxManager) {
          return formatToolError("No mide.yaml found - reload not available");
        }

        try {
          const newLoaded = await loadConfig();
          const result = await processManager.reload(newLoaded.config);

          // Emit reload event
          emitReloadEvent(
            tmuxManager.sessionName,
            result.added,
            result.removed,
            result.changed,
            result.tabsReloaded
          );

          const summary = [
            `Reload complete:`,
            `  Added: ${result.added.length > 0 ? result.added.join(", ") : "none"}`,
            `  Removed: ${result.removed.length > 0 ? result.removed.join(", ") : "none"}`,
            `  Changed: ${result.changed.length > 0 ? result.changed.join(", ") : "none"}`,
            `  Tabs: ${result.tabsReloaded ? "reloaded" : "unchanged"}`,
          ].join("\n");

          return {
            content: [{ type: "text", text: summary }],
          };
        } catch (err) {
          return formatToolError(`Reload failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      default:
        return formatToolError(`Unknown tool: ${name}`);
    }
  }

  // Create MCP server
  const server = new Server(
    {
      name: "mcp-ide",
      version: "0.4.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let tools: Tool[] = [];

    // Full mode: all tools available (with mide.yaml)
    if (processManager) {
      tools = [...MCP_TOOLS];
    } else if (embeddedTmuxManager) {
      // Embedded mode: pane tools only (no service management)
      tools = MCP_TOOLS.filter(t =>
        ["create_pane", "run_interaction", "remove_pane", "send_keys"].includes(t.name)
      );
    }
    // Minimal mode: no tools (tmux not available)

    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Handle test_blocking specially (needs server access for progress notifications)
      if (name === "test_blocking") {
        const parsed = TestBlockingSchema.parse(args);
        const durationMs = parsed.duration_seconds * 1000;
        const heartbeatIntervalMs = parsed.heartbeat_interval_ms ?? 25000;
        const progressToken = request.params._meta?.progressToken;

        console.error(`[mide] test_blocking: duration=${durationMs}ms, heartbeat=${heartbeatIntervalMs}ms, progressToken=${progressToken}`);

        const startTime = Date.now();
        let heartbeatCount = 0;

        while (Date.now() - startTime < durationMs) {
          // Wait for heartbeat interval or remaining time, whichever is shorter
          const remaining = durationMs - (Date.now() - startTime);
          const waitTime = Math.min(heartbeatIntervalMs, remaining);

          if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }

          // Send progress notification if we have a token and still have time left
          if (progressToken && Date.now() - startTime < durationMs) {
            heartbeatCount++;
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / durationMs, 0.99);

            console.error(`[mide] Sending progress heartbeat #${heartbeatCount}: ${(progress * 100).toFixed(1)}%`);

            try {
              await server.notification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress,
                  total: 1,
                  message: `Blocking... ${Math.round(elapsed / 1000)}s / ${parsed.duration_seconds}s`
                }
              });
            } catch (err) {
              console.error(`[mide] Failed to send progress notification:`, err);
            }
          }
        }

        const actualDuration = Date.now() - startTime;
        return {
          content: [{
            type: "text",
            text: `Blocked for ${actualDuration}ms (requested ${durationMs}ms)\nSent ${heartbeatCount} progress heartbeats\nProgress token was: ${progressToken ? "provided" : "NOT provided"}`
          }],
        };
      }

      // Handle run_interaction (needs server access for progress notifications)
      if (name === "run_interaction") {
        if (!interactionManager) {
          return formatToolError("Interaction tools require an active session");
        }

        const parsed = RunInteractionSchema.parse(args);

        if (!parsed.schema && !parsed.ink_file && !parsed.command) {
          return formatToolError("Either schema, ink_file, or command is required");
        }

        const interactionId = await interactionManager.create({
          schema: parsed.schema,
          inkFile: parsed.ink_file,
          inkArgs: parsed.ink_args,
          command: parsed.command,
          title: parsed.title,
          timeoutMs: parsed.timeout_ms,
        });

        // Non-blocking mode: timeout_ms === 0
        if (parsed.timeout_ms === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ interaction_id: interactionId, status: "started" })
            }],
          };
        }

        // Blocking mode with progress heartbeats
        const progressToken = request.params._meta?.progressToken;
        const heartbeatIntervalMs = 25000;
        const startTime = Date.now();
        let heartbeatCount = 0;

        console.error(`[mide] run_interaction: id=${interactionId}, progressToken=${progressToken}`);

        while (true) {
          // Wait for result with short timeout
          const result = await interactionManager.waitForResult(interactionId, heartbeatIntervalMs);

          if (result) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify(result)
              }],
            };
          }

          // Check if interaction was cancelled/timed out
          const state = interactionManager.getState(interactionId);
          if (state && state.status !== "pending") {
            return {
              content: [{
                type: "text",
                text: JSON.stringify(state.result || { action: state.status })
              }],
            };
          }

          // Check tool-level timeout if specified
          if (parsed.timeout_ms && parsed.timeout_ms > 0) {
            const elapsed = Date.now() - startTime;
            if (elapsed >= parsed.timeout_ms) {
              await interactionManager.cancel(interactionId);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ action: "timeout" })
                }],
              };
            }
          }

          // Send progress heartbeat to keep connection alive
          if (progressToken) {
            heartbeatCount++;
            console.error(`[mide] Sending progress heartbeat #${heartbeatCount} for ${interactionId}`);

            try {
              await server.notification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: 0,
                  message: "Waiting for user input..."
                }
              });
            } catch (err) {
              console.error(`[mide] Failed to send progress notification:`, err);
            }
          }
        }
      }

      // Handle send_keys
      if (name === "send_keys") {
        const { name: paneName, keys } = args as { name: string; keys: string };
        if (!tmuxManager && !embeddedTmuxManager) {
          return formatToolError("No active session");
        }
        const mgr = tmuxManager ?? embeddedTmuxManager;
        await mgr!.sendKeys(paneName, keys);
        return {
          content: [{ type: "text", text: `Sent keys to "${paneName}"` }],
        };
      }

      return await handleToolCall(name, args as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mide] Tool call failed: ${name}:`, msg);
      return formatToolError(msg);
    }
  });

  // Handle shutdown
  let isShuttingDown = false;
  async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.error("[mide] Shutting down...");

    try {
      // Stop file watcher first
      if (fileWatcher) {
        fileWatcher.stop();
      }

      // Stop all pending interactions first
      if (interactionManager) {
        await interactionManager.stopAll();
      }

      // Stop embedded panes
      if (embeddedTmuxManager) {
        await embeddedTmuxManager.stopAll();
      }

      // Then stop all processes and destroy tmux session
      if (processManager) {
        await processManager.stopAll();
      }
    } catch (err) {
      console.error("[mide] Error during shutdown:", err);
    }

    // Give a moment for cleanup to complete
    setTimeout(() => process.exit(0), 100);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up when Claude disconnects
  server.onclose = () => {
    console.error("[mide] Claude disconnected - cleaning up session");
    shutdown();
  };

  console.error("[mide] Server running");
  if (processManager && tmuxManager) {
    console.error(`[mide] Managing ${processManager.listProcesses().length} tabs in session: ${tmuxManager.sessionName}`);
  }
}

main().catch((err) => {
  // Stringify error to avoid Node inspect issues with some error types
  const errorMsg = err instanceof Error ? err.stack || err.message : String(err);
  console.error("Fatal error:", errorMsg);
  process.exit(1);
});
