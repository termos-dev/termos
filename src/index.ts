#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { loadConfig, configExists, expandEnvVars } from "./config.js";
import { ProcessManager } from "./process-manager.js";
import { TmuxManager, listIdeSessions, isInsideTmux, cleanupStaleSession } from "./tmux-manager.js";
import { InteractionManager, type InteractionResult } from "./interaction-manager.js";
import { emitReloadEvent, emitStatusEvent, getLatestStatus } from "./events.js";
import { parseFormSchema, type FormSchema } from "@mcp-ide/shared";

/** Read from stdin if piped */
async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.join("") || null;
}

async function loadConfigAndTmux(): Promise<{
  config: Awaited<ReturnType<typeof loadConfig>>;
  tmux: TmuxManager;
}> {
  const loaded = await loadConfig();
  const defaultName = path.basename(loaded.configDir);
  const sessionName = loaded.config.settings?.sessionName
    ? expandEnvVars(loaded.config.settings.sessionName)
    : defaultName;
  const tmux = TmuxManager.createOwned(sessionName, {
    sessionPrefix: loaded.config.settings?.tmuxSessionPrefix,
  }, loaded.configDir);
  return { config: loaded, tmux };
}

function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function showHelp(): void {
  console.log(`
mide - Interactive Development Environment for Claude Code

Usage:
  mide up                     Start services and attach (foreground)
  mide up -d                  Start services in background (detached)
  mide up --stream            Start and stream events (for agents, use run_in_background)
  mide connect                Attach to existing session
  mide connect --stream       Stream events from existing session
  mide down                   Stop session
  mide sessions               List active sessions

  mide ls                     List tabs and services
  mide start <service>        Start a service
  mide stop <service>         Stop a service
  mide restart <service>      Restart a service
  mide reload                 Reload config (hot-reload)

  mide pane <name> <cmd>      Create a terminal pane
  mide rm <name>              Remove a pane
  mide send <pane> <keys>     Send keys to a pane

  mide status "msg"           Set LLM status (shown in welcome page + tmux title)
  mide status "msg" --prompt "suggestion"  Set status with suggested prompts
  mide status --clear         Clear status
  mide status                 Show current status

  mide ask                    Ask user questions (schema from stdin)
  mide run <file.tsx>         Run an Ink component
  mide run -- <command>       Run a shell command in Canvas

Options:
  -d, --detach    Run in background (don't attach)
  --stream        Stream events continuously (requires run_in_background)
  --json          Output as JSON (auto-enabled when no TTY)
  -h, --help      Show this help

Agent Usage:
  echo '{"questions":[...]}' | mide ask   # Ask user questions
  mide run component.tsx --prompt "Hi"    # Run with args
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    showHelp();
    process.exit(0);
  }

  // Sessions command - no config needed
  if (cmd === "sessions") {
    const sessions = await listIdeSessions();
    if (sessions.length === 0) {
      console.log("No active sessions. Run 'mide up' to start.");
    } else {
      console.log("SESSIONS\n");
      for (const s of sessions) {
        const status = s.isStale ? "[STALE]" : "[ACTIVE]";
        console.log(`  ${s.name.padEnd(25)} ${s.windows} win  ${formatAge(s.created).padEnd(4)}  ${status}`);
      }
      console.log("\nUse: mide connect <name> | mide gc");
    }
    process.exit(0);
  }

  // GC command - no config needed
  if (cmd === "gc") {
    const sessions = await listIdeSessions();
    const stale = sessions.filter(s => s.isStale);
    if (stale.length === 0) {
      console.log("No stale sessions.");
    } else {
      for (const s of stale) {
        await cleanupStaleSession(s.name);
        console.log(`Cleaned: ${s.name}`);
      }
    }
    process.exit(0);
  }

  // Up command
  if (cmd === "up") {
    const detach = args.includes("-d") || args.includes("--detach");
    // Auto-enable JSON mode when no TTY (agent/script context)
    const json = args.includes("--json") || !process.stdout.isTTY;
    // Only stream if explicitly requested with --stream (requires run_in_background)
    const stream = args.includes("--stream") && !detach;

    if (!configExists()) {
      console.error(json ? JSON.stringify({ error: "No mide.yaml" }) : "No mide.yaml found");
      process.exit(1);
    }

    const { config: loaded, tmux } = await loadConfigAndTmux();
    const sessionExists = await tmux.sessionExists();

    if (!sessionExists) {
      await tmux.createSession();
      if (!json) console.log(`Created: ${tmux.sessionName}`);
    }

    const pm = new ProcessManager(loaded.configDir, {
      settings: loaded.config.settings,
      tmuxManager: tmux,
    });

    if (!sessionExists) {
      await pm.startAll(loaded.config);
    } else {
      await pm.loadProcesses(loaded.config);
    }

    const formatStatus = () => {
      const tabs = pm.listTabs();
      const services = tabs.filter(t => t.type === "service");
      const ready = services.filter(s => s.status === "running" || s.status === "ready");

      if (json) {
        return JSON.stringify({
          session: tmux.sessionName,
          status: ready.length === services.length ? "ready" : "starting",
          services: services.map(s => ({ name: s.name, status: s.status ?? "unknown", port: s.port })),
          eventsFile: tmux.getEventsFile(),
          logsDir: tmux.getLogDir(),
        });
      }
      const lines = [`Session: ${tmux.sessionName}`, `Status: ${ready.length}/${services.length} ready`, ""];
      for (const s of services) {
        const icon = s.status === "running" ? "✓" : s.status === "crashed" ? "✗" : "○";
        lines.push(`  ${icon} ${s.name}${s.port ? `:${s.port}` : ""} - ${s.status ?? "unknown"}`);
      }
      lines.push("", `Events: ${tmux.getEventsFile()}`);
      return lines.join("\n");
    };

    // Wait for services to be ready
    if (!json) console.log("Waiting for services...");
    const start = Date.now();
    let allReady = false;
    let hasCrashed = false;

    while (Date.now() - start < 60000) {
      const tabs = pm.listTabs();
      const services = tabs.filter(t => t.type === "service");
      const done = services.filter(s => s.status === "running" || s.status === "crashed");
      if (done.length === services.length) {
        allReady = true;
        hasCrashed = done.some(s => s.status === "crashed");
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!allReady) {
      console.error(json ? JSON.stringify({ error: "timeout" }) : "Timeout waiting for services");
    }

    // Always select window 0 before exiting (even on timeout)
    try {
      await tmux.selectWindow(0);
    } catch {
      // Ignore
    }

    if (!allReady && !stream) {
      // Exit on timeout unless streaming (streaming continues regardless)
      console.log(formatStatus());
      process.exit(1);
    }

    console.log(formatStatus());

    // -d means detached (background), otherwise attach (foreground like docker compose)
    if (detach) {
      process.exit(hasCrashed ? 1 : 0);
    }

    // Foreground mode: attach to session
    if (!process.stdout.isTTY) {
      // No TTY available
      if (stream) {
        // Streaming mode (--stream): output events continuously (requires run_in_background)
        const eventsFile = tmux.getEventsFile();
        let lastSize = 0;

        // Read existing events
        try {
          const content = fs.readFileSync(eventsFile, "utf-8");
          for (const line of content.split("\n")) {
            if (line.trim()) console.log(line);
          }
          lastSize = fs.statSync(eventsFile).size;
        } catch { /* file may not exist yet */ }

        // Tail events file, output new lines to stdout
        setInterval(() => {
          try {
            const stat = fs.statSync(eventsFile);
            if (stat.size > lastSize) {
              const fd = fs.openSync(eventsFile, "r");
              const buffer = Buffer.alloc(stat.size - lastSize);
              fs.readSync(fd, buffer, 0, buffer.length, lastSize);
              fs.closeSync(fd);
              for (const line of buffer.toString().split("\n")) {
                if (line.trim()) console.log(line);
              }
              lastSize = stat.size;
            }
          } catch { /* ignore errors */ }
        }, 500);

        // Handle graceful shutdown
        const shutdown = () => {
          console.log(JSON.stringify({ type: "shutdown", ts: Date.now() }));
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        return; // Keep process alive
      }

      // Default: output status and exit (safe for agents without run_in_background)
      process.exit(hasCrashed ? 1 : 0);
    }

    if (isInsideTmux()) {
      const embedded = await TmuxManager.createEmbedded();
      await embedded.createPane("mide-view", `TMUX= tmux attach -t ${tmux.sessionName}`, process.cwd(), undefined, { direction: "auto", skipRebalance: true });
      console.log(`Opened in split pane`);
      process.exit(0);
    }

    process.exit(await tmux.attach());
  }

  // Down command
  if (cmd === "down") {
    const tmux = configExists() ? (await loadConfigAndTmux()).tmux : TmuxManager.createOwned(path.basename(process.cwd()));
    if (await tmux.sessionExists()) {
      await tmux.destroySession();
      console.log(`Stopped: ${tmux.sessionName}`);
    } else {
      console.log("No active session");
    }
    process.exit(0);
  }

  // Connect command - attach to existing session only
  if (cmd === "connect" || cmd === "attach") {
    // Auto-enable JSON mode when no TTY (agent/script context)
    const json = args.includes("--json") || !process.stdout.isTTY;
    const stream = args.includes("--stream");
    const { config: loaded, tmux } = configExists()
      ? await loadConfigAndTmux()
      : { config: null, tmux: TmuxManager.createOwned(path.basename(process.cwd())) };

    if (!(await tmux.sessionExists())) {
      console.error(json ? JSON.stringify({ error: "No active session" }) : "No active session. Run: mide up");
      process.exit(1);
    }

    // No TTY - output status or stream events
    if (!process.stdout.isTTY) {
      if (stream) {
        // Streaming mode (--stream): output events continuously (requires run_in_background)
        const eventsFile = tmux.getEventsFile();
        let lastSize = 0;

        // Read existing events
        try {
          const content = fs.readFileSync(eventsFile, "utf-8");
          for (const line of content.split("\n")) {
            if (line.trim()) console.log(line);
          }
          lastSize = fs.statSync(eventsFile).size;
        } catch { /* file may not exist yet */ }

        // Tail events file
        setInterval(() => {
          try {
            const stat = fs.statSync(eventsFile);
            if (stat.size > lastSize) {
              const fd = fs.openSync(eventsFile, "r");
              const buffer = Buffer.alloc(stat.size - lastSize);
              fs.readSync(fd, buffer, 0, buffer.length, lastSize);
              fs.closeSync(fd);
              for (const line of buffer.toString().split("\n")) {
                if (line.trim()) console.log(line);
              }
              lastSize = stat.size;
            }
          } catch { /* ignore errors */ }
        }, 500);

        // Handle graceful shutdown
        const shutdown = () => {
          console.log(JSON.stringify({ type: "shutdown", ts: Date.now() }));
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        return; // Keep process alive
      }

      // Default: output status JSON and exit (safe for agents)
      console.log(JSON.stringify({
        session: tmux.sessionName,
        eventsFile: tmux.getEventsFile(),
      }));
      process.exit(0);
    }

    if (isInsideTmux()) {
      const embedded = await TmuxManager.createEmbedded();
      await embedded.createPane("mide-view", `TMUX= tmux attach -t ${tmux.sessionName}`, process.cwd(), undefined, { direction: "auto", skipRebalance: true });
      console.log(`Opened in split pane`);
      process.exit(0);
    }

    console.log(`Attaching to ${tmux.sessionName}...`);
    process.exit(await tmux.attach());
  }

  // Commands that require active session
  if (!configExists()) {
    console.error("No mide.yaml found");
    process.exit(1);
  }

  const { config: loaded, tmux } = await loadConfigAndTmux();
  if (!(await tmux.sessionExists())) {
    console.error(`No active session. Run: mide up`);
    process.exit(1);
  }

  const pm = new ProcessManager(loaded.configDir, { settings: loaded.config.settings, tmuxManager: tmux });
  await pm.loadProcesses(loaded.config);

  // ls
  if (cmd === "ls") {
    const tabs = pm.listTabs();
    if (tabs.length === 0) {
      console.log("No tabs defined");
    } else {
      for (const t of tabs) {
        const parts = [t.name, t.type];
        if (t.type === "service") {
          parts.push(t.status ?? "unknown");
          if (t.port) parts.push(`port=${t.port}`);
          parts.push(`log=${tmux.getServiceLog(t.name)}`);
        }
        console.log(parts.join(" | "));
      }
      console.log(`\nEvents: ${tmux.getEventsFile()}`);
    }
    process.exit(0);
  }

  // start/stop/restart
  if (cmd === "start" || cmd === "stop" || cmd === "restart") {
    const name = args[1];
    if (!name) { console.error(`Usage: mide ${cmd} <service>`); process.exit(1); }
    if (pm.isLayoutTab(name)) { console.error(`"${name}" is a layout tab`); process.exit(1); }
    if (cmd === "start") await pm.startProcess(name);
    else if (cmd === "stop") await pm.stopProcess(name);
    else await pm.restartProcess(name);
    console.log(`${cmd}: ${name}`);
    process.exit(0);
  }

  // reload
  if (cmd === "reload") {
    const newLoaded = await loadConfig();
    const result = await pm.reload(newLoaded.config);
    emitReloadEvent(tmux.configDir, result.added, result.removed, result.changed, result.tabsReloaded);
    console.log(`Reload: +${result.added.length} -${result.removed.length} ~${result.changed.length}`);
    process.exit(0);
  }

  // pane
  if (cmd === "pane") {
    const [, name, ...rest] = args;
    if (!name || rest.length === 0) { console.error("Usage: mide pane <name> <command>"); process.exit(1); }
    const terminal = await pm.createDynamicTerminal(name, rest.join(" "));
    console.log(`Created: ${terminal.name} (${terminal.paneId})`);
    process.exit(0);
  }

  // rm
  if (cmd === "rm") {
    const name = args[1];
    if (!name) { console.error("Usage: mide rm <name>"); process.exit(1); }
    await pm.removeDynamicTerminal(name);
    console.log(`Removed: ${name}`);
    process.exit(0);
  }

  // send
  if (cmd === "send") {
    const [, pane, ...keys] = args;
    if (!pane || keys.length === 0) { console.error("Usage: mide send <pane> <keys>"); process.exit(1); }
    await tmux.sendKeys(pane, keys.join(" "));
    console.log(`Sent keys to ${pane}`);
    process.exit(0);
  }

  // status - set/get LLM status with optional prompts
  if (cmd === "status") {
    const clearIdx = args.indexOf("--clear");
    if (clearIdx > 0) {
      emitStatusEvent(tmux.configDir, null);
      await tmux.setSessionTitle(tmux.sessionName);
      await pm.showWelcomeComponent();
      console.log("Status cleared");
      process.exit(0);
    }

    // Parse --prompt flags
    const prompts: string[] = [];
    let message: string | undefined;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--prompt" && args[i + 1]) {
        prompts.push(args[++i]);
      } else if (!args[i].startsWith("--") && !message) {
        message = args[i];
      }
    }

    // No args = show current status
    if (!message) {
      const status = getLatestStatus(tmux.configDir);
      if (status && status.message) {
        console.log(`Status: ${status.message}`);
        if (status.prompts?.length) {
          console.log("Prompts:");
          for (const p of status.prompts) console.log(`  - ${p}`);
        }
      } else {
        console.log("No status set");
      }
      process.exit(0);
    }

    // Set status
    emitStatusEvent(tmux.configDir, message, prompts.length > 0 ? prompts : undefined);
    await tmux.setSessionTitle(`${tmux.sessionName} - ${message}`);
    await pm.showWelcomeComponent();
    console.log(`Status: ${message}`);
    if (prompts.length > 0) {
      console.log("Prompts:");
      for (const p of prompts) console.log(`  - ${p}`);
    }
    process.exit(0);
  }

  // ask - read schema from stdin, display form, return results
  if (cmd === "ask") {
    const titleIdx = args.indexOf("--title");
    const title = titleIdx > 0 ? args[titleIdx + 1] : undefined;
    const stdinData = await readStdin();
    if (!stdinData) {
      console.error("Usage: echo '{\"questions\":[{\"question\":\"...\",\"header\":\"key\"}]}' | mide ask");
      process.exit(1);
    }

    let schema: FormSchema;
    try {
      schema = parseFormSchema(JSON.parse(stdinData.trim()));
    } catch (err) {
      console.error("Invalid schema:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const im = new InteractionManager({ tmuxManager: tmux, cwd: loaded.configDir, configDir: loaded.configDir });
    const id = await im.create({ schema, title, timeoutMs: 300000 });
    const result = await new Promise<InteractionResult>(r => im.on("interactionComplete", (i, res) => i === id && r(res)));
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  // run
  if (cmd === "run") {
    const restArgs = args.slice(1);
    const wait = restArgs[0] === "--wait" ? (restArgs.shift(), true) : false;
    const sepIdx = restArgs.indexOf("--");

    let inkFile: string | undefined;
    let inkArgs: Record<string, string> | undefined;
    let command: string | undefined;

    if (sepIdx !== -1) {
      command = restArgs.slice(sepIdx + 1).join(" ");
      if (!command) { console.error("Usage: mide run -- <command>"); process.exit(1); }
    } else {
      inkFile = restArgs[0];
      if (!inkFile?.endsWith(".tsx") && !inkFile?.endsWith(".jsx")) {
        console.error("Usage: mide run <file.tsx> or mide run -- <command>");
        process.exit(1);
      }
      // Parse --key value, --key=value, or --arg key=value
      inkArgs = {};
      for (let i = 1; i < restArgs.length; i++) {
        const arg = restArgs[i];
        if (arg === "--arg" && restArgs[i + 1]) {
          const [k, ...v] = restArgs[++i].split("=");
          if (k) inkArgs[k] = v.join("=");
        } else if (arg.startsWith("--")) {
          const key = arg.slice(2);
          const eqIdx = key.indexOf("=");
          if (eqIdx > 0) inkArgs[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
          else if (restArgs[i + 1]?.charAt(0) !== "-") inkArgs[key] = restArgs[++i];
        }
      }
      if (!Object.keys(inkArgs).length) inkArgs = undefined;
    }

    const im = new InteractionManager({ tmuxManager: tmux, cwd: loaded.configDir, configDir: loaded.configDir });
    const id = await im.create({ inkFile, inkArgs, command, timeoutMs: wait || inkFile ? 300000 : 0 });

    if (!wait && command) {
      console.log(JSON.stringify({ id, status: "started" }));
      process.exit(0);
    }

    const result = await new Promise<InteractionResult>(resolve => {
      im.on("interactionComplete", (iid: string, r: InteractionResult) => { if (iid === id) resolve(r); });
    });
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}\nRun 'mide help' for usage`);
  process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
