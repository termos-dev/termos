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
import { loadConfig, configExists } from "./config.js";
import { ProcessManager } from "./process-manager.js";
import { TmuxManager, EmbeddedTmuxManager, isTmuxAvailable, listIdeSessions, isInsideTmux } from "./tmux-manager.js";
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
      console.error("Run 'mcp-ide help' for usage");
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
mcp-ide - MCP server for managing development processes

Usage:
  mcp-ide [options]           Start MCP server (default)
  mcp-ide sessions            List active IDE tmux sessions
  mcp-ide attach [name]       Attach to a tmux session

Options:
  -h, --help              Show this help message
  -c, --config <path>     Path to mide.yaml config file

Configuration:
  Create an mide.yaml file in your project root to define processes.
  Or specify a custom path with --config.

tmux Integration:
  Processes run in tmux panes for live output viewing.
  Use 'mcp-ide attach' to see process output in your terminal.

Example mide.yaml:
  services:
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
    console.log(`  ${session.name.padEnd(30)} ${session.windows} window(s)   ${age}`);
  }

  console.log("");
  console.log("Use: mcp-ide attach <name>");
}

/**
 * Attach to a tmux session
 */
async function commandAttach(sessionName?: string): Promise<void> {
  const sessions = await listIdeSessions();

  if (sessions.length === 0) {
    console.error("No active IDE sessions found.");
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
    const expectedName = `mide-${projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;

    const match = sessions.find((s) => s.name === expectedName || s.name.startsWith(expectedName));

    if (match) {
      targetSession = match.name;
    } else if (sessions.length === 1) {
      // Only one session, use it
      targetSession = sessions[0].name;
    } else {
      console.error("Multiple sessions available. Please specify which one:");
      sessions.forEach((s) => console.error(`  mcp-ide attach ${s.name}`));
      process.exit(1);
    }
  }

  console.log(`Attaching to ${targetSession}...`);

  // Create a temporary TmuxManager just to attach
  const tmux = new TmuxManager(targetSession.replace(/^mide-/, ""));
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
  mode: z.enum(["embedded", "standalone"]).optional().describe("Tmux mode: embedded (current session) or standalone (separate IDE session)"),
});

const RemovePaneSchema = z.object({
  name: z.string().describe("Name of the pane to remove"),
});

const CapturePaneSchema = z.object({
  name: z.string().describe("Name of the pane to capture"),
  lines: z.number().optional().describe("Number of lines to capture (default: 100)"),
  parse_markers: z.boolean().optional().describe("Parse __MCP_PROGRESS__ and __MCP_RESULT__ markers from output"),
});

const GetUserInteractionSchema = z.object({
  interaction_id: z.string().describe("Interaction ID from show_user_interaction"),
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

const ShowUserInteractionSchema = z.object({
  schema: FormSchemaSchema.optional().describe("Form schema (AskUserQuestion-compatible)"),
  ink_file: z.string().optional().describe("Path to custom Ink component file (.tsx/.jsx)"),
  title: z.string().optional().describe("Form title"),
  group: z.string().optional().describe("tmux layout group"),
  timeout_ms: z.number().optional().describe("Auto-cancel after N ms (default: blocks indefinitely)"),
});

const SetStatusSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed"]),
  message: z.string().optional(),
});

// Test blocking tool schema (for internal testing)
const TestBlockingSchema = z.object({
  duration_seconds: z.number().describe("How long to block in seconds"),
  heartbeat_interval_ms: z.number().optional().describe("Progress heartbeat interval in ms (default: 25000)"),
});

// MCP Tools - 7 tools
const MCP_TOOLS: Tool[] = [
  // Service tools (require mide.yaml)
  {
    name: "list_services",
    description: "List all services from mide.yaml with status, port, URL, and health",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "manage_service",
    description: "Start, stop, or restart a service defined in mide.yaml",
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
    name: "show_user_interaction",
    description: "Show an interactive Ink component or form to the user. Blocks until user completes.",
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
        ink_file: { type: "string", description: "Path to Ink component (.tsx) - resolves from .mide/interactive/" },
        title: { type: "string", description: "Title" },
        timeout_ms: { type: "number", description: "Auto-cancel timeout in ms" },
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
    name: "capture_pane",
    description: "Capture terminal output from a pane or service",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the pane or service" },
        lines: { type: "number", description: "Number of lines to capture (default: 100)" },
        parse_markers: { type: "boolean", description: "Parse __MCP_PROGRESS__ and __MCP_RESULT__ markers" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_user_interaction",
    description: "Get result from a completed interaction (works even if pane was killed)",
    inputSchema: {
      type: "object",
      properties: {
        interaction_id: { type: "string", description: "Interaction ID from show_user_interaction" },
      },
      required: ["interaction_id"],
    },
  },
  // Status tool
  {
    name: "set_status",
    description: "Update the terminal window title/status indicator",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
        message: { type: "string", description: "Custom message" },
      },
      required: ["status"],
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
    console.error("[mide] Error: tmux is required but not found.");
    console.error("[mide] Install tmux: brew install tmux (macOS) or apt install tmux (Linux)");
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

  // Initialize embedded tmux manager if running inside tmux
  if (isInsideTmux()) {
    try {
      embeddedTmuxManager = await EmbeddedTmuxManager.create();
      console.error(`[mide] Running in embedded mode (session: ${embeddedTmuxManager.getSessionName()})`);

      // Initialize interaction manager for embedded mode (works without mide.yaml)
      // Uses ~/.mide/interactive/ for global components
      interactionManager = new InteractionManager({
        tmuxManager: embeddedTmuxManager as unknown as TmuxManager,
        cwd: workspaceDir,
      });
    } catch (err) {
      console.error(`[mide] Failed to create embedded tmux manager: ${err}`);
    }
  }

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

    console.error(`[mide] Created tmux session: ${tmuxManager.sessionName}`);

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
    });

    // Auto-attach terminal if configured and there are services to show
    const hasServices = Object.keys(config.services || {}).length > 0;
    if (config.settings?.autoAttachTerminal && hasServices) {
      await tmuxManager.openTerminal(config.settings?.terminalApp, configDir);
    } else if (hasServices) {
      console.error(`[mide] Attach with: tmux attach -t ${tmuxManager.sessionName}`);
    }
  }

  // Tool handler
  async function handleToolCall(name: string, args: Record<string, unknown>) {
    switch (name) {
      case "list_services": {
        if (!processManager) {
          return formatToolError("No mide.yaml found - service management not available");
        }
        const services = processManager.listProcesses();
        if (services.length === 0) {
          return {
            content: [{ type: "text", text: "No services defined in mide.yaml" }],
          };
        }
        // Return full status including URL
        const formatted = services.map((p) => {
          const proc = processManager!.getProcess(p.name);
          const state = proc?.getState();
          const parts = [`${p.name}: ${p.status}`];
          if (p.port) parts.push(`port=${p.port}`);
          if (state?.url) parts.push(`url=${state.url}`);
          if (p.healthy !== undefined) parts.push(`healthy=${p.healthy}`);
          if (state?.pid) parts.push(`pid=${state.pid}`);
          if (p.error) parts.push(`error=${p.error}`);
          return parts.join(" | ");
        });
        return {
          content: [{ type: "text", text: formatted.join("\n") }],
        };
      }

      case "manage_service": {
        if (!processManager) {
          return formatToolError("No mide.yaml found - service management not available");
        }
        const parsed = ManageServiceSchema.parse(args);
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

        // Determine effective mode: tool param > config > auto-detect
        const effectiveMode = parsed.mode
          ?? config?.settings?.tmuxMode
          ?? (isInsideTmux() ? "embedded" : "standalone");

        // Embedded mode: create pane in user's current tmux session
        if (effectiveMode === "embedded" && embeddedTmuxManager) {
          const paneId = await embeddedTmuxManager.createPane(
            parsed.name,
            parsed.command,
            configDir
          );
          return {
            content: [{
              type: "text",
              text: `Created embedded terminal "${parsed.name}"\n` +
                `Command: ${parsed.command}\n` +
                `Pane ID: ${paneId}\n` +
                `Session: ${embeddedTmuxManager.getSessionName()}`
            }],
          };
        }

        // Standalone mode: use separate MIDE session (requires config)
        if (!processManager || !tmuxManager) {
          if (effectiveMode === "embedded" && !embeddedTmuxManager) {
            return formatToolError("Embedded mode requires running inside tmux");
          }
          return formatToolError("Standalone mode requires mide.yaml");
        }

        const terminal = await processManager.createDynamicTerminal(
          parsed.name,
          parsed.command,
          parsed.group
        );

        // Auto-open terminal if not already attached (skip if inside tmux - user can switch manually)
        if (config?.settings?.autoAttachTerminal !== false && !isInsideTmux()) {
          await tmuxManager.openTerminal(config?.settings?.terminalApp, configDir);
        }

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

      case "capture_pane": {
        const parsed = CapturePaneSchema.parse(args);
        const lines = parsed.lines ?? 100;

        let content: string | null = null;

        // Try embedded manager first
        if (embeddedTmuxManager?.hasPane(parsed.name)) {
          content = await embeddedTmuxManager.capturePane(parsed.name, lines);
        } else if (tmuxManager) {
          // Try standalone tmux manager
          content = await tmuxManager.capturePane(parsed.name, lines);
        }

        if (content === null) {
          return formatToolError("Pane not found or no tmux session active");
        }

        // Parse markers if requested
        if (parsed.parse_markers) {
          const progress: unknown[] = [];
          let result: unknown = null;

          for (const line of content.split("\n")) {
            if (line.includes("__MCP_PROGRESS__:")) {
              const jsonStr = line.split("__MCP_PROGRESS__:")[1];
              try {
                progress.push(JSON.parse(jsonStr));
              } catch { /* ignore parse errors */ }
            }
            if (line.includes("__MCP_RESULT__:")) {
              const jsonStr = line.split("__MCP_RESULT__:")[1];
              try {
                result = JSON.parse(jsonStr);
              } catch { /* ignore parse errors */ }
            }
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({ progress, result, raw: content }),
            }],
          };
        }

        return {
          content: [{ type: "text", text: content || "(no output)" }],
        };
      }

      case "get_user_interaction": {
        if (!interactionManager) {
          return formatToolError("Interaction tools not available - tmux required");
        }

        const parsed = GetUserInteractionSchema.parse(args);
        const state = interactionManager.getState(parsed.interaction_id);

        // Check in-memory state first
        if (state?.result) {
          return {
            content: [{ type: "text", text: JSON.stringify(state.result) }],
          };
        }

        // Try reading from file directly (handles case where pane was killed)
        const filePath = `/tmp/mcp-interaction-${parsed.interaction_id}.result`;
        try {
          if (existsSync(filePath)) {
            const fileContent = readFileSync(filePath, "utf-8");
            const result = JSON.parse(fileContent);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
            };
          }
        } catch { /* ignore read errors */ }

        // Still pending or not found
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "pending" }) }],
        };
      }

      case "set_status": {
        const parsed = SetStatusSchema.parse(args);

        // Use embedded manager if available, otherwise standalone
        if (embeddedTmuxManager) {
          await embeddedTmuxManager.setStatus(parsed.status, parsed.message);
        } else if (tmuxManager) {
          await tmuxManager.setStatus(parsed.status, parsed.message);
        } else {
          return formatToolError("No tmux session active");
        }

        return {
          content: [{ type: "text", text: `Status: ${parsed.status}${parsed.message ? ` - ${parsed.message}` : ""}` }],
        };
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
        ["create_pane", "show_user_interaction", "remove_pane", "capture_pane", "get_user_interaction", "set_status"].includes(t.name)
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

      // Handle show_user_interaction (needs server access for progress notifications)
      if (name === "show_user_interaction") {
        if (!interactionManager) {
          return formatToolError("Interaction tools not available - tmux required");
        }

        const parsed = ShowUserInteractionSchema.parse(args);

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

        // Auto-open terminal if not already attached (skip if inside tmux - user can switch manually)
        if (tmuxManager && config?.settings?.autoAttachTerminal !== false && !isInsideTmux()) {
          await tmuxManager.openTerminal(config?.settings?.terminalApp, configDir);
        }

        // Blocking mode with progress heartbeats (always blocks now)
        const progressToken = request.params._meta?.progressToken;
        const heartbeatIntervalMs = 25000;
        const startTime = Date.now();
        let heartbeatCount = 0;

        console.error(`[mide] show_user_interaction: id=${interactionId}, progressToken=${progressToken}`);

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

  console.error("[mide] MCP server running");
  if (processManager && tmuxManager) {
    console.error(`[mide] Managing ${processManager.listProcesses().length} services in tmux session: ${tmuxManager.sessionName}`);
  }
}

main().catch((err) => {
  // Stringify error to avoid Node inspect issues with some error types
  const errorMsg = err instanceof Error ? err.stack || err.message : String(err);
  console.error("Fatal error:", errorMsg);
  process.exit(1);
});
