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
import { loadConfig, configExists } from "./config.js";
import { ProcessManager } from "./process-manager.js";
import { TmuxManager, isTmuxAvailable, listSidecarSessions } from "./tmux-manager.js";
import { InteractionManager } from "./interaction-manager.js";

type Command = "server" | "sessions" | "attach" | "help";

interface ParsedArgs {
  command: Command;
  config?: string;
  sessionName?: string;
}

// Parse CLI arguments
function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let config: string | undefined;
  let sessionName: string | undefined;

  // Check for subcommand
  const firstArg = args[0];

  if (!firstArg || firstArg.startsWith("-")) {
    // No subcommand, default to server mode
    // Parse remaining flags
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--help" || arg === "-h") {
        return { command: "help" };
      } else if (arg === "--config" || arg === "-c") {
        config = args[++i];
        if (!config) {
          console.error("Error: --config requires a path argument");
          process.exit(1);
        }
      }
    }
    return { command: "server", config };
  }

  // Handle subcommands
  switch (firstArg) {
    case "sessions":
      return { command: "sessions" };

    case "attach":
      sessionName = args[1];
      return { command: "attach", sessionName };

    case "help":
    case "--help":
    case "-h":
      return { command: "help" };

    default:
      // Unknown arg, might be a flag for server mode
      if (firstArg.startsWith("-")) {
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (arg === "--help" || arg === "-h") {
            return { command: "help" };
          } else if (arg === "--config" || arg === "-c") {
            config = args[++i];
          }
        }
        return { command: "server", config };
      }
      console.error(`Unknown command: ${firstArg}`);
      console.error("Run 'mcp-sidecar help' for usage");
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
mcp-sidecar - MCP server for managing development processes

Usage:
  mcp-sidecar [options]           Start MCP server (default)
  mcp-sidecar sessions            List active sidecar tmux sessions
  mcp-sidecar attach [name]       Attach to a tmux session

Options:
  -h, --help              Show this help message
  -c, --config <path>     Path to sidecar.yaml config file

Configuration:
  Create a sidecar.yaml file in your project root to define processes.
  Or specify a custom path with --config.

tmux Integration:
  Processes run in tmux panes for live output viewing.
  Use 'mcp-sidecar attach' to see process output in your terminal.

Example sidecar.yaml:
  processes:
    api:
      command: npm run dev
      port: 3000
    frontend:
      command: npm run dev
      cwd: ./frontend
      port: 5173
`);
}

/**
 * List all active sidecar sessions
 */
async function commandSessions(): Promise<void> {
  const sessions = await listSidecarSessions();

  if (sessions.length === 0) {
    console.log("No active sidecar sessions found.");
    console.log("\nStart a session by running 'mcp-sidecar' in a project directory with sidecar.yaml");
    return;
  }

  console.log("SIDECAR SESSIONS");
  console.log("================");
  console.log("");

  for (const session of sessions) {
    const age = formatAge(session.created);
    console.log(`  ${session.name.padEnd(30)} ${session.windows} window(s)   ${age}`);
  }

  console.log("");
  console.log("Use: mcp-sidecar attach <name>");
}

/**
 * Attach to a tmux session
 */
async function commandAttach(sessionName?: string): Promise<void> {
  const sessions = await listSidecarSessions();

  if (sessions.length === 0) {
    console.error("No active sidecar sessions found.");
    process.exit(1);
  }

  let targetSession: string;

  if (sessionName) {
    // Find exact or prefix match
    const match = sessions.find(
      (s) => s.name === sessionName || s.name.startsWith(sessionName)
    );
    if (!match) {
      console.error(`Session "${sessionName}" not found.`);
      console.error("\nAvailable sessions:");
      sessions.forEach((s) => console.error(`  ${s.name}`));
      process.exit(1);
    }
    targetSession = match.name;
  } else {
    // Auto-detect: try to find session for current directory
    const projectName = path.basename(process.cwd());
    const expectedName = `sidecar-${projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;

    const match = sessions.find((s) => s.name === expectedName || s.name.startsWith(expectedName));

    if (match) {
      targetSession = match.name;
    } else if (sessions.length === 1) {
      // Only one session, use it
      targetSession = sessions[0].name;
    } else {
      console.error("Multiple sessions available. Please specify which one:");
      sessions.forEach((s) => console.error(`  mcp-sidecar attach ${s.name}`));
      process.exit(1);
    }
  }

  console.log(`Attaching to ${targetSession}...`);

  // Create a temporary TmuxManager just to attach
  const tmux = new TmuxManager(targetSession.replace(/^sidecar-/, ""));
  (tmux as { sessionName: string }).sessionName = targetSession;
  tmux.attach();
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

// Process tool schemas
const StartProcessSchema = z.object({
  name: z.string().describe("Process name from sidecar.yaml"),
  args: z.string().optional().describe("Additional arguments to pass to the command"),
  force: z.boolean().optional().describe("Kill any process using the port before starting"),
});

const StopProcessSchema = z.object({
  name: z.string().describe("Process name to stop"),
});

const RestartProcessSchema = z.object({
  name: z.string().describe("Process name to restart"),
});

const GetStatusSchema = z.object({
  name: z.string().describe("Process name"),
});

const GetLogsSchema = z.object({
  name: z.string().describe("Process name"),
  stream: z.enum(["stdout", "stderr", "combined"]).optional().describe("Log stream (default: combined)"),
  tail: z.number().optional().describe("Number of lines to return (default: 100)"),
});

const GetUrlSchema = z.object({
  name: z.string().describe("Process name"),
});

// Dynamic terminal schemas
const CreateTerminalSchema = z.object({
  name: z.string().describe("Unique name for the terminal"),
  command: z.string().describe("Command to run in the terminal"),
  group: z.string().optional().describe("Group to place the terminal in (default: 'dynamic')"),
});

const RemoveTerminalSchema = z.object({
  name: z.string().describe("Name of the terminal to remove"),
});

// Test blocking tool schema (for validating progress heartbeats)
const TestBlockingSchema = z.object({
  duration_seconds: z.number().describe("How long to block in seconds"),
  heartbeat_interval_ms: z.number().optional().describe("Progress heartbeat interval in ms (default: 25000)"),
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

const ShowInteractionSchema = z.object({
  schema: FormSchemaSchema.optional().describe("Form schema (AskUserQuestion-compatible)"),
  ink_file: z.string().optional().describe("Path to custom Ink component file (.tsx/.jsx)"),
  title: z.string().optional().describe("Form title"),
  group: z.string().optional().describe("tmux layout group"),
  timeout_ms: z.number().optional().describe("Auto-cancel after N ms"),
  block: z.boolean().optional().describe("Block until done (default: true)"),
});

const GetInteractionResultSchema = z.object({
  interaction_id: z.string().describe("Interaction ID from non-blocking show_interaction"),
  block: z.boolean().optional().describe("Wait for result (default: false)"),
});

const CancelInteractionSchema = z.object({
  interaction_id: z.string().describe("Interaction ID to cancel"),
});

// Process tools
const PROCESS_TOOLS: Tool[] = [
  {
    name: "list_processes",
    description: "List all processes defined in sidecar.yaml with their status",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "start_process",
    description: "Start a process defined in sidecar.yaml",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name from sidecar.yaml" },
        args: { type: "string", description: "Additional arguments to pass to the command" },
        force: { type: "boolean", description: "Kill any process using the port before starting" },
      },
      required: ["name"],
    },
  },
  {
    name: "stop_process",
    description: "Stop a running process",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name to stop" },
      },
      required: ["name"],
    },
  },
  {
    name: "restart_process",
    description: "Restart a process",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name to restart" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_status",
    description: "Get detailed status of a process",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_logs",
    description: "Get log output from a process",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name" },
        stream: { type: "string", enum: ["stdout", "stderr", "combined"], description: "Log stream (default: combined)" },
        tail: { type: "number", description: "Number of lines to return (default: 100)" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_url",
    description: "Get the URL for a process (if it has a port)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_terminal",
    description: "Create a dynamic terminal pane running a command. The terminal is placed in the specified layout group.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique name for the terminal" },
        command: { type: "string", description: "Command to run in the terminal" },
        group: { type: "string", description: "Group to place the terminal in (default: 'dynamic')" },
      },
      required: ["name", "command"],
    },
  },
  {
    name: "remove_terminal",
    description: "Remove a dynamic terminal by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the terminal to remove" },
      },
      required: ["name"],
    },
  },
  {
    name: "test_blocking",
    description: "Test tool that blocks for a specified duration while sending progress heartbeats. Used to validate timeout handling.",
    inputSchema: {
      type: "object",
      properties: {
        duration_seconds: { type: "number", description: "How long to block in seconds" },
        heartbeat_interval_ms: { type: "number", description: "Progress heartbeat interval in ms (default: 25000)" },
      },
      required: ["duration_seconds"],
    },
  },
  {
    name: "show_interaction",
    description: "Show an interactive form or custom Ink component in a tmux pane and collect user input. By default blocks until user completes the form.",
    inputSchema: {
      type: "object",
      properties: {
        schema: {
          type: "object",
          description: "Form schema with questions (AskUserQuestion-compatible)",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string", description: "The question to ask" },
                  header: { type: "string", description: "Short label (max 12 chars)" },
                  options: { type: "array", description: "Selection options (omit for text input)" },
                  multiSelect: { type: "boolean", description: "Allow multiple selections" },
                  inputType: { type: "string", enum: ["text", "textarea", "password"] },
                  placeholder: { type: "string" },
                  validation: { type: "string", description: "Regex pattern" },
                },
                required: ["question", "header"],
              },
            },
          },
          required: ["questions"],
        },
        ink_file: { type: "string", description: "Path to custom Ink component file (.tsx/.jsx) - saves tokens!" },
        title: { type: "string", description: "Form title" },
        group: { type: "string", description: "tmux layout group" },
        timeout_ms: { type: "number", description: "Auto-cancel timeout in ms" },
        block: { type: "boolean", description: "Block until done (default: true)" },
      },
    },
  },
  {
    name: "get_interaction_result",
    description: "Get the result of a non-blocking interaction",
    inputSchema: {
      type: "object",
      properties: {
        interaction_id: { type: "string", description: "Interaction ID from show_interaction" },
        block: { type: "boolean", description: "Wait for result (default: false)" },
      },
      required: ["interaction_id"],
    },
  },
  {
    name: "cancel_interaction",
    description: "Cancel an active interaction",
    inputSchema: {
      type: "object",
      properties: {
        interaction_id: { type: "string", description: "Interaction ID to cancel" },
      },
      required: ["interaction_id"],
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

    case "attach":
      await commandAttach(parsedArgs.sessionName);
      // attach() doesn't return - it replaces the process
      break;

    case "server":
      // Continue to MCP server mode below
      break;
  }

  // Server mode: Start MCP server
  const workspaceDir = process.cwd();

  // Check if tmux is available (required)
  if (!(await isTmuxAvailable())) {
    console.error("[sidecar] Error: tmux is required but not found.");
    console.error("[sidecar] Install tmux: brew install tmux (macOS) or apt install tmux (Linux)");
    process.exit(1);
  }

  // Check if config exists (either specified or in cwd)
  const hasConfig = parsedArgs.config || configExists();
  if (!hasConfig) {
    console.error("[sidecar] No sidecar.yaml found in current directory");
    console.error("[sidecar] Running in minimal mode - no process management available");
  }

  // Load config if it exists
  let config: Awaited<ReturnType<typeof loadConfig>>["config"] | undefined;
  let configDir: string = workspaceDir;
  let processManager: ProcessManager | undefined;
  let tmuxManager: TmuxManager | undefined;
  let interactionManager: InteractionManager | undefined;

  if (hasConfig) {
    const loaded = await loadConfig(parsedArgs.config);
    config = loaded.config;
    configDir = loaded.configDir;

    // Create tmux session with project name
    const projectName = path.basename(configDir);
    // Top-level layout takes precedence over settings.layout
    const layout = config.layout ?? config.settings?.layout;
    tmuxManager = new TmuxManager(projectName, {
      sessionPrefix: config.settings?.tmuxSessionPrefix,
      layout,
    });
    await tmuxManager.createSession();

    console.error(`[sidecar] Created tmux session: ${tmuxManager.sessionName}`);

    // Initialize process manager with tmux
    processManager = new ProcessManager(configDir, {
      settings: config.settings,
      tmuxManager,
    });
    await processManager.startAll(config);

    // Initialize interaction manager for interactive forms
    interactionManager = new InteractionManager({
      tmuxManager,
      inkRunnerPath: path.join(process.cwd(), "packages", "ink-runner", "dist", "index.js"),
      cwd: configDir,  // Project root for resolving .sidecar/interactive paths
    });

    // Auto-attach terminal if configured
    if (config.settings?.autoAttachTerminal) {
      await tmuxManager.openTerminal(config.settings?.terminalApp, configDir);
    } else {
      console.error(`[sidecar] Attach with: tmux attach -t ${tmuxManager.sessionName}`);
    }
  }

  // Tool handler
  async function handleToolCall(name: string, args: Record<string, unknown>) {
    switch (name) {
      case "list_processes": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const processes = processManager.listProcesses();
        if (processes.length === 0) {
          return {
            content: [{ type: "text", text: "No processes defined in sidecar.yaml" }],
          };
        }
        const formatted = processes.map((p) => {
          const parts = [`${p.name}: ${p.status}`];
          if (p.port) parts.push(`port=${p.port}`);
          if (p.healthy !== undefined) parts.push(`healthy=${p.healthy}`);
          if (p.error) parts.push(`error=${p.error}`);
          return parts.join(" | ");
        });
        return {
          content: [{ type: "text", text: formatted.join("\n") }],
        };
      }

      case "start_process": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = StartProcessSchema.parse(args);
        await processManager.startProcess(parsed.name, {
          args: parsed.args,
          force: parsed.force,
        });
        return {
          content: [{ type: "text", text: `Process "${parsed.name}" started` }],
        };
      }

      case "stop_process": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = StopProcessSchema.parse(args);
        await processManager.stopProcess(parsed.name);
        return {
          content: [{ type: "text", text: `Process "${parsed.name}" stopped` }],
        };
      }

      case "restart_process": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = RestartProcessSchema.parse(args);
        await processManager.restartProcess(parsed.name);
        return {
          content: [{ type: "text", text: `Process "${parsed.name}" restarted` }],
        };
      }

      case "get_status": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = GetStatusSchema.parse(args);
        const process = processManager.getProcess(parsed.name);
        if (!process) {
          return formatToolError(`Process "${parsed.name}" not found`);
        }
        const state = process.getState();
        const lines = [
          `Name: ${state.name}`,
          `Status: ${state.status}`,
        ];
        if (state.pid) lines.push(`PID: ${state.pid}`);
        if (state.port) lines.push(`Port: ${state.port}`);
        if (state.url) lines.push(`URL: ${state.url}`);
        if (state.healthy !== undefined) lines.push(`Healthy: ${state.healthy}`);
        if (state.restartCount > 0) lines.push(`Restart Count: ${state.restartCount}`);
        if (state.error) lines.push(`Error: ${state.error}`);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }

      case "get_logs": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = GetLogsSchema.parse(args);
        const proc = processManager.getProcess(parsed.name);
        if (!proc) {
          return formatToolError(`Process "${parsed.name}" not found`);
        }

        // Get logs from tmux pane
        const tail = parsed.tail ?? 100;
        const content = await proc.getLogsAsync(tail);

        return {
          content: [{ type: "text", text: content || "(no logs yet)" }],
        };
      }

      case "get_url": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = GetUrlSchema.parse(args);
        const url = processManager.getUrl(parsed.name);
        if (!url) {
          return {
            content: [{ type: "text", text: `Process "${parsed.name}" has no URL (no port configured or detected)` }],
          };
        }
        return {
          content: [{ type: "text", text: url }],
        };
      }

      case "create_terminal": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = CreateTerminalSchema.parse(args);
        const terminal = await processManager.createDynamicTerminal(
          parsed.name,
          parsed.command,
          parsed.group
        );
        const groups = processManager.getAvailableGroups();
        return {
          content: [{
            type: "text",
            text: `Created terminal "${terminal.name}" in group "${terminal.group}"\n` +
              `Command: ${terminal.command}\n` +
              `Pane ID: ${terminal.paneId}\n` +
              (groups.length > 1 ? `Available groups: ${groups.join(", ")}` : "")
          }],
        };
      }

      case "remove_terminal": {
        if (!processManager) {
          return formatToolError("No sidecar.yaml found - process management not available");
        }
        const parsed = RemoveTerminalSchema.parse(args);
        await processManager.removeDynamicTerminal(parsed.name);
        return {
          content: [{ type: "text", text: `Removed terminal "${parsed.name}"` }],
        };
      }

      // test_blocking is handled separately in the request handler (needs server access)

      default:
        return formatToolError(`Unknown tool: ${name}`);
    }
  }

  // Create MCP server
  const server = new Server(
    {
      name: "mcp-sidecar",
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

    // Process tools (always available if config exists)
    if (processManager) {
      tools = [...tools, ...PROCESS_TOOLS];
    } else {
      // test_blocking is always available (for testing progress notifications)
      tools.push({
        name: "test_blocking",
        description: "Test tool that blocks for a specified duration while sending progress heartbeats. Used to validate timeout handling.",
        inputSchema: {
          type: "object",
          properties: {
            duration_seconds: { type: "number", description: "How long to block in seconds" },
            heartbeat_interval_ms: { type: "number", description: "Progress heartbeat interval in ms (default: 25000)" },
          },
          required: ["duration_seconds"],
        },
      });
    }

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

        console.error(`[sidecar] test_blocking: duration=${durationMs}ms, heartbeat=${heartbeatIntervalMs}ms, progressToken=${progressToken}`);

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

            console.error(`[sidecar] Sending progress heartbeat #${heartbeatCount}: ${(progress * 100).toFixed(1)}%`);

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
              console.error(`[sidecar] Failed to send progress notification:`, err);
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

      // Handle show_interaction (needs server access for progress notifications)
      if (name === "show_interaction") {
        if (!interactionManager || !tmuxManager) {
          return formatToolError("No sidecar.yaml found - interaction tools not available");
        }

        const parsed = ShowInteractionSchema.parse(args);

        if (!parsed.schema && !parsed.ink_file) {
          return formatToolError("Either schema or ink_file is required");
        }

        const interactionId = await interactionManager.create({
          schema: parsed.schema,
          inkFile: parsed.ink_file,
          title: parsed.title,
          group: parsed.group,
          timeoutMs: parsed.timeout_ms,
        });

        // Non-blocking mode
        if (parsed.block === false) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ interaction_id: interactionId, status: "pending" })
            }],
          };
        }

        // Blocking mode with progress heartbeats
        const progressToken = request.params._meta?.progressToken;
        const heartbeatIntervalMs = 25000;
        const startTime = Date.now();
        let heartbeatCount = 0;

        console.error(`[sidecar] show_interaction blocking: id=${interactionId}, progressToken=${progressToken}`);

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
          if (parsed.timeout_ms) {
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
            console.error(`[sidecar] Sending progress heartbeat #${heartbeatCount} for ${interactionId}`);

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
              console.error(`[sidecar] Failed to send progress notification:`, err);
            }
          }
        }
      }

      // Handle get_interaction_result
      if (name === "get_interaction_result") {
        if (!interactionManager) {
          return formatToolError("No sidecar.yaml found - interaction tools not available");
        }

        const parsed = GetInteractionResultSchema.parse(args);
        const state = interactionManager.getState(parsed.interaction_id);

        if (!state) {
          return formatToolError(`Interaction "${parsed.interaction_id}" not found`);
        }

        // If blocking requested and still pending, wait
        if (parsed.block && state.status === "pending") {
          const result = await interactionManager.waitForResult(parsed.interaction_id, 30000);
          if (result) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ status: "completed", result })
              }],
            };
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: state.status,
              result: state.result
            })
          }],
        };
      }

      // Handle cancel_interaction
      if (name === "cancel_interaction") {
        if (!interactionManager) {
          return formatToolError("No sidecar.yaml found - interaction tools not available");
        }

        const parsed = CancelInteractionSchema.parse(args);
        const success = await interactionManager.cancel(parsed.interaction_id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success })
          }],
        };
      }

      return await handleToolCall(name, args as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sidecar] Tool call failed: ${name}:`, msg);
      return formatToolError(msg);
    }
  });

  // Handle shutdown
  let isShuttingDown = false;
  async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.error("[sidecar] Shutting down...");

    try {
      // Stop all pending interactions first
      if (interactionManager) {
        await interactionManager.stopAll();
      }

      // Then stop all processes and destroy tmux session
      if (processManager) {
        await processManager.stopAll();
      }
    } catch (err) {
      console.error("[sidecar] Error during shutdown:", err);
    }

    // Give a moment for cleanup to complete
    setTimeout(() => process.exit(0), 100);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[sidecar] MCP server running");
  if (processManager && tmuxManager) {
    console.error(`[sidecar] Managing ${processManager.listProcesses().length} processes in tmux session: ${tmuxManager.sessionName}`);
  }
}

main().catch((err) => {
  // Stringify error to avoid Node inspect issues with some error types
  const errorMsg = err instanceof Error ? err.stack || err.message : String(err);
  console.error("Fatal error:", errorMsg);
  process.exit(1);
});
