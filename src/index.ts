#!/usr/bin/env node

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { InteractionManager, type InteractionResult } from "./interaction-manager.js";
import { ensureEventsFile } from "./runtime.js";
import { selectPaneHost, VALID_POSITIONS, type PositionPreset } from "./pane-hosts.js";
import { generateFullHelp, type FormSchema } from "@termosdev/shared";
import { startCommandWatcher, type ParseMode } from "./command-watcher.js";
import { getComponentHeight, rowsToPercent } from "./height-calculator.js";
import { loadMergedInstructions } from "./instructions-loader.js";

function showRunHelp(): void {
  console.log(generateFullHelp());
}

function showHelp(): void {
  console.log(`
termos - Interactive UI runner for Claude Code (Zellij, Ghostty, or macOS Terminal)

Usage:
  termos up [--session <name>]                     Stream events (long-running)

  termos run --title <text> <component>            Run an Ink component (built-in or custom .tsx)
  termos run --title <text> --cmd "<command>"      Run a shell command (recommended for agents)
  termos run --title <text> --cmd-file <path>      Run a shell command from file
  termos run --title <text> -- <command>           Run a shell command (passthrough)

Built-in components: ask, confirm, checklist, code, diff, table, progress, mermaid, markdown,
                     plan-viewer, chart, select, tree, json, gauge

Options:
  --session <name>      Session name (required outside Zellij; overrides TERMOS_SESSION_NAME)
  --title <text>        Title (required)
  --cmd "<string>"      Inline shell command (supports &&, |, ||, etc.)
  --cmd-file <path>     Read command from file
  --position <preset>   Pane position preset (default: floating)
                        Floating: floating, floating:center, floating:top-left, floating:top-right,
                                  floating:bottom-left, floating:bottom-right
                        Split (Zellij): split, split:right, split:down
                        Tab: tab

Live Data Options:
  --watch-cmd "<cmd>"   Shell command to run periodically for live data
  --interval <ms>       Refresh interval in milliseconds (default: 1000)
  --parse <mode>        Output parsing: number | json | lines | raw | auto (default: auto)

  -h, --help            Show this help

Examples:
  termos run --title "Lines" gauge --watch-cmd "wc -l *.ts | awk '{print \\$1}'" --max 10000
  termos run --title "Procs" gauge --watch-cmd "ps aux | wc -l" --interval 2000
`);

  const instructions = loadMergedInstructions(process.cwd());
  if (instructions) {
    console.log("\n## Project Instructions\n");
    console.log(instructions);
  }
}

function parseSessionArg(args: string[]): { sessionName?: string; rest: string[] } {
  let sessionName: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--session") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        console.error("Error: --session requires a value.");
        process.exit(1);
      }
      sessionName = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--session=")) {
      const value = arg.slice("--session=".length);
      if (!value) {
        console.error("Error: --session requires a value.");
        process.exit(1);
      }
      sessionName = value;
      continue;
    }
    rest.push(arg);
  }
  return { sessionName, rest };
}

async function handleUp(args: string[]): Promise<void> {
  const { sessionName, rest } = parseSessionArg(args);
  if (rest.includes("--json")) {
    console.error("Error: --json is not supported. 'termos up' always streams.");
    process.exit(1);
  }
  const host = selectPaneHost(process.cwd(), sessionName);
  const eventsFile = ensureEventsFile(host.sessionName);

  console.log("Termos up is running.");
  console.log(`Session: ${host.sessionName}`);
  console.log("Streaming events...\n");

  let buffer = "";
  let offset = 0;
  try {
    offset = fs.statSync(eventsFile).size;
  } catch {
    offset = 0;
  }

  const readNew = () => {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(eventsFile);
    } catch {
      return;
    }
    if (stats.size < offset) {
      offset = 0;
    }
    if (stats.size === offset) {
      return;
    }
    const length = stats.size - offset;
    if (length <= 0) {
      return;
    }
    const buf = Buffer.alloc(length);
    try {
      const fd = fs.openSync(eventsFile, "r");
      const bytesRead = fs.readSync(fd, buf, 0, length, offset);
      fs.closeSync(fd);
      if (bytesRead <= 0) return;
      offset += bytesRead;
      buffer += buf.toString("utf8", 0, bytesRead);
    } catch {
      return;
    }

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        process.stdout.write(`${line}\n`);
      }
    }
  };

  // Poll for new events; keeps the process alive as a background service.
  setInterval(readNew, 200);
}

async function handleRun(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    showRunHelp();
    process.exit(0);
  }

  const { sessionName, rest } = parseSessionArg(args);
  let title: string | undefined;
  let position: PositionPreset | undefined;
  const hasWait = rest.includes("--wait");
  const hasNoWait = rest.includes("--no-wait");
  const restArgs = rest.filter(
    arg => arg !== "--wait" && arg !== "--no-wait"
  );

  let cmdValue: string | undefined;
  let cmdFileValue: string | undefined;
  let watchCmdValue: string | undefined;
  let intervalValue: number | undefined;
  let parseValue: ParseMode | undefined;
  const builtinComponents: Record<string, string> = {
    "markdown": "markdown.tsx",
    "markdown.tsx": "markdown.tsx",
    "plan-viewer": "plan-viewer.tsx",
    "plan-viewer.tsx": "plan-viewer.tsx",
    "confirm": "confirm.tsx",
    "confirm.tsx": "confirm.tsx",
    "checklist": "checklist.tsx",
    "checklist.tsx": "checklist.tsx",
    "code": "code.tsx",
    "code.tsx": "code.tsx",
    "diff": "diff.tsx",
    "diff.tsx": "diff.tsx",
    "table": "table.tsx",
    "table.tsx": "table.tsx",
    "progress": "progress.tsx",
    "progress.tsx": "progress.tsx",
    "mermaid": "mermaid.tsx",
    "mermaid.tsx": "mermaid.tsx",
    "chart": "chart.tsx",
    "chart.tsx": "chart.tsx",
    "select": "select.tsx",
    "select.tsx": "select.tsx",
    "tree": "tree.tsx",
    "tree.tsx": "tree.tsx",
    "json": "json.tsx",
    "json.tsx": "json.tsx",
    "gauge": "gauge.tsx",
    "gauge.tsx": "gauge.tsx",
  };
  for (let i = 0; i < restArgs.length; i++) {
    const arg = restArgs[i];
    if (arg === "--") break;
    if (arg === "--title" && restArgs[i + 1]) {
      title = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--title=")) {
      title = arg.slice(8);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--position" && restArgs[i + 1]) {
      position = restArgs[i + 1] as PositionPreset;
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--position=")) {
      position = arg.slice("--position=".length) as PositionPreset;
      restArgs.splice(i, 1); i--;
    } else if (arg === "--cmd" && restArgs[i + 1]) {
      cmdValue = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--cmd=")) {
      cmdValue = arg.slice("--cmd=".length);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--cmd-file" && restArgs[i + 1]) {
      cmdFileValue = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--cmd-file=")) {
      cmdFileValue = arg.slice("--cmd-file=".length);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--watch-cmd" && restArgs[i + 1]) {
      watchCmdValue = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--watch-cmd=")) {
      watchCmdValue = arg.slice("--watch-cmd=".length);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--interval" && restArgs[i + 1]) {
      intervalValue = parseInt(restArgs[i + 1], 10);
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--interval=")) {
      intervalValue = parseInt(arg.slice("--interval=".length), 10);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--parse" && restArgs[i + 1]) {
      parseValue = restArgs[i + 1] as ParseMode;
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--parse=")) {
      parseValue = arg.slice("--parse=".length) as ParseMode;
      restArgs.splice(i, 1); i--;
    }
  }

  const sepIdx = restArgs.indexOf("--");
  const wait = hasWait ? true : (hasNoWait ? false : false);
  const emitRunError = (message: string) => {
    console.log(JSON.stringify({ action: "cancel", error: message }));
  };

  // Validate position preset
  if (position && !VALID_POSITIONS.includes(position)) {
    emitRunError(`Invalid position "${position}". Valid options: ${VALID_POSITIONS.join(", ")}`);
    process.exit(1);
  }

  // Validate --cmd, --cmd-file, and -- separator are mutually exclusive
  const cmdSources = [
    cmdValue !== undefined,
    cmdFileValue !== undefined,
    sepIdx !== -1
  ].filter(Boolean).length;

  if (cmdSources > 1) {
    emitRunError("Use only one of --cmd, --cmd-file, or '--' separator.");
    process.exit(1);
  }

  // Validate --cmd-file exists and is readable
  if (cmdFileValue) {
    try {
      if (!fs.existsSync(cmdFileValue)) {
        emitRunError(`Command file not found: ${cmdFileValue}`);
        process.exit(1);
      }
      const stats = fs.statSync(cmdFileValue);
      if (!stats.isFile()) {
        emitRunError(`Not a file: ${cmdFileValue}`);
        process.exit(1);
      }
    } catch (err) {
      emitRunError(`Error accessing command file: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  const titleValue = title?.trim();
  if (!titleValue) {
    const commandArgs = sepIdx !== -1 ? restArgs.slice(sepIdx + 1) : [];
    const hasTitleAfterSeparator = commandArgs.some(arg => arg === "--title" || arg.startsWith("--title="));
    if (hasTitleAfterSeparator) {
      emitRunError("--title is required and must appear before '--' (command separator).");
    } else {
      emitRunError("--title is required.");
    }
    process.exit(1);
  }

  const component = restArgs[0]?.toLowerCase();
  const isCommandMode = cmdValue !== undefined || cmdFileValue !== undefined || sepIdx !== -1;

  const host = selectPaneHost(process.cwd(), sessionName);

  // Default position: tab for commands, floating for components
  const effectivePosition: PositionPreset = position ?? (isCommandMode ? "tab" : "floating");

  let inkFile: string | undefined;
  let inkArgs: Record<string, string> | undefined;
  let command: string | undefined;

  // Built-in components (resolve from ink-runner/components)
  // Special handling for `ask` - uses SchemaForm directly instead of a component file
  if (component === "ask") {
    const cmdArgs: Record<string, string> = {};
    const optionValues: string[] = [];
    for (let i = 1; i < restArgs.length; i++) {
      const arg = restArgs[i];
      if (!arg.startsWith("--")) continue;
      const key = arg.slice(2);
      const eqIdx = key.indexOf("=");
      const flag = eqIdx > 0 ? key.slice(0, eqIdx) : key;
      const value = eqIdx > 0 ? key.slice(eqIdx + 1) : restArgs[i + 1];

      if (flag === "options" || flag === "choices") {
        if (eqIdx > 0) {
          optionValues.push(value);
        } else {
          // Collect all subsequent tokens until next flag
          const collected: string[] = [];
          let j = i + 1;
          while (j < restArgs.length && !restArgs[j].startsWith("--")) {
            collected.push(restArgs[j]);
            j += 1;
          }
          if (collected.length > 0) {
            optionValues.push(...collected);
            i = j - 1;
          }
        }
        continue;
      }

      if (eqIdx > 0) {
        cmdArgs[flag] = value;
      } else if (restArgs[i + 1]?.charAt(0) !== "-") {
        cmdArgs[flag] = restArgs[++i];
      }
    }

    const emitCliError = (message: string) => {
      console.log(JSON.stringify({ action: "cancel", error: message }));
    };

    if (cmdArgs["file"]) {
      emitCliError("--file is not supported for ask. Use --questions '<json>'");
      process.exit(1);
    }

    let questionsArg = cmdArgs["questions"];
    const promptArg = cmdArgs["prompt"] || cmdArgs["question"];
    if (!questionsArg && promptArg) {
      const placeholderArg = cmdArgs["placeholder"] || cmdArgs["default"];
      const headerArg = cmdArgs["header"];
      const question: Record<string, unknown> = {
        question: promptArg,
        header: headerArg,
        placeholder: placeholderArg,
      };
      if (optionValues.length > 0) {
        try {
          const joined = optionValues.join(",");
          const trimmed = joined.trim();
          if (trimmed.startsWith("[")) {
            question.options = JSON.parse(trimmed);
          } else {
            question.options = joined.split(",").map(s => s.trim()).filter(Boolean);
          }
        } catch {
          emitCliError("Invalid JSON in --options/--choices");
          process.exit(1);
        }
      }
      questionsArg = JSON.stringify([question]);
    }

    if (!questionsArg) {
      emitCliError("--questions or --prompt is required for ask component");
      process.exit(1);
    }


    const normalizeQuestions = (schemaInput: FormSchema | { questions?: Array<Record<string, unknown>> }): FormSchema => {
      if (!schemaInput || typeof schemaInput !== "object") return schemaInput as FormSchema;
      const base = schemaInput as { questions?: Array<Record<string, unknown>> };
      if (!Array.isArray(base.questions)) return schemaInput as FormSchema;

      const used = new Set<string>();
      const slugify = (value: string, fallback: string) => {
        const slug = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
        return slug.length > 0 ? slug : fallback;
      };

      const questions = base.questions.map((q, idx) => {
        const next = { ...q };
        if (!next.question && typeof (next as { prompt?: unknown }).prompt === "string") {
          next.question = (next as { prompt?: string }).prompt;
        }
        if (!next.options && Array.isArray((next as { choices?: unknown }).choices)) {
          next.options = (next as { choices?: unknown[] }).choices;
        }
        if (!next.placeholder && typeof (next as { default?: unknown }).default === "string") {
          next.placeholder = (next as { default?: string }).default;
        }

        const questionText = typeof next.question === "string" ? next.question : "";
        let header = typeof next.header === "string" ? next.header : "";
        if (!header) {
          header = slugify(questionText, `q${idx + 1}`);
        }
        let unique = header;
        let counter = 2;
        while (used.has(unique)) {
          unique = `${header}_${counter++}`;
        }
        used.add(unique);
        next.header = unique;

        const options = next.options;
        if (Array.isArray(options)) {
          const normalized = options.map((opt) => {
            if (typeof opt === "string" || typeof opt === "number") {
              return { label: String(opt) };
            }
            if (opt && typeof opt === "object" && "label" in opt) {
              const label = (opt as { label?: unknown }).label;
              return { ...opt, label: typeof label === "string" ? label : String(label ?? "") };
            }
            return { label: String(opt) };
          });
          next.options = normalized;
        }
        return next;
      });

      return { ...base, questions } as FormSchema;
    };

    let schema: FormSchema;
    try {
      const parsed = JSON.parse(questionsArg);
      let shaped: FormSchema;
      if (Array.isArray(parsed)) {
        shaped = { questions: parsed } as FormSchema;
      } else if (parsed && typeof parsed === "object" && !("questions" in (parsed as Record<string, unknown>))) {
        const entries = Object.entries(parsed as Record<string, unknown>);
        const questions = entries.map(([question, value]) => {
          if (typeof value === "string") {
            return { question, header: value };
          }
          if (value && typeof value === "object") {
            return { question, ...(value as Record<string, unknown>) };
          }
          return { question };
        });
        shaped = { questions } as FormSchema;
      } else {
        shaped = parsed as FormSchema;
      }
      schema = normalizeQuestions(shaped);
    } catch {
      emitCliError("Invalid JSON in --questions");
      process.exit(1);
    }

    ensureEventsFile(host.sessionName);
    const im = new InteractionManager({ cwd: process.cwd(), host });
    const id = await im.create({
      schema,
      title: titleValue,
      timeoutMs: wait ? 300000 : 0,
      position: effectivePosition,
      component: "ask",
    });

    if (wait) {
      const result = await new Promise<InteractionResult>(resolve => {
        im.on("interactionComplete", (iid: string, r: InteractionResult) => { if (iid === id) resolve(r); });
      });
      console.log(JSON.stringify(result));
    } else {
      console.log(JSON.stringify({ id, status: "started" }));
    }
    process.exit(0);
  }

  if (cmdValue) {
    command = cmdValue;
  } else if (cmdFileValue) {
    command = fs.readFileSync(cmdFileValue, "utf8").trim();
  } else if (sepIdx !== -1) {
    command = restArgs.slice(sepIdx + 1).join(" ");
    if (!command) { console.error("Usage: termos run -- <command>"); process.exit(1); }
  } else {
    inkFile = restArgs[0];

    const builtinFile = builtinComponents[inkFile?.toLowerCase() ?? ""];
    if (builtinFile) {
      const distPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "ink-runner", "components", builtinFile);
      const devPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "packages", "ink-runner", "components", builtinFile);
      inkFile = fs.existsSync(distPath) ? distPath : devPath;
    } else if (!inkFile?.endsWith(".tsx") && !inkFile?.endsWith(".jsx")) {
      console.error("Usage: termos run <component> or termos run -- <command>");
      console.error("\nBuilt-in components:");
      console.error("  ask, confirm, checklist, code, diff, table, progress, mermaid");
      console.error("  markdown, plan-viewer");
      console.error("\nExamples:");
      console.error("  termos run ask --questions '{\"questions\":[...]}'");
      console.error("  termos run confirm --prompt 'Continue?'");
      process.exit(1);
    }

    inkArgs = {};
    const positionalArgMap: Record<string, string> = {
      "confirm": "prompt",
      "confirm.tsx": "prompt",
      "checklist": "items",
      "checklist.tsx": "items",
      "progress": "steps",
      "progress.tsx": "steps",
      "markdown": "file",
      "markdown.tsx": "file",
      "plan-viewer": "file",
      "plan-viewer.tsx": "file",
    };
    const positionalKey = positionalArgMap[component ?? ""];

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
      } else if (positionalKey && !inkArgs[positionalKey]) {
        inkArgs[positionalKey] = arg;
      }
    }
    if (titleValue && !("title" in inkArgs)) {
      inkArgs["title"] = titleValue;
    }
    if (!Object.keys(inkArgs).length) inkArgs = undefined;
  }

  // Handle --watch-cmd: set up command watcher with temp file
  let watcherCleanup: (() => void) | undefined;
  let tempFile: string | undefined;

  if (watchCmdValue) {
    tempFile = path.join(os.tmpdir(), `termos-watch-${Date.now()}.json`);

    // Initialize with empty data
    fs.writeFileSync(tempFile, JSON.stringify({ value: 0 }));

    // Ensure inkArgs exists
    if (!inkArgs) inkArgs = {};

    // Override file arg to use temp file
    inkArgs["file"] = tempFile;

    // Start the watcher
    watcherCleanup = startCommandWatcher({
      cmd: watchCmdValue,
      interval: intervalValue || 1000,
      parse: parseValue || "auto",
      outputFile: tempFile,
      componentType: component,
      componentArgs: inkArgs,
      onError: (err) => {
        console.error(`Watch command error: ${err.message}`);
      },
    });

    // Clean up on exit
    const cleanup = () => {
      if (watcherCleanup) watcherCleanup();
      if (tempFile) {
        try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  }

  ensureEventsFile(host.sessionName);
  const im = new InteractionManager({ cwd: process.cwd(), host });
  const componentName = isCommandMode ? undefined : component;

  // Calculate component height based on data
  let heightPercent: number | undefined;
  if (!isCommandMode && component) {
    const termRows = process.stdout.rows || 40;
    const idealRows = getComponentHeight(component, (inkArgs ?? {}) as Record<string, string>);
    heightPercent = rowsToPercent(idealRows, termRows);
  }

  const id = await im.create({
    inkFile,
    inkArgs,
    command,
    title: titleValue,
    timeoutMs: wait ? 300000 : 0,
    position: effectivePosition,
    component: componentName,
    isCommand: isCommandMode,
    heightPercent,
  });

  // When using --watch-cmd, we must wait for the component to finish
  // so we can keep updating the temp file
  const shouldWait = wait || !!watchCmdValue;

  if (shouldWait) {
    const result = await new Promise<InteractionResult>(resolve => {
      im.on("interactionComplete", (iid: string, r: InteractionResult) => { if (iid === id) resolve(r); });
    });
    console.log(JSON.stringify(result));
  } else {
    console.log(JSON.stringify({ id, status: "started" }));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    showHelp();
    process.exit(0);
  }

  if (cmd === "up") {
    await handleUp(args.slice(1));
    return;
  }

  if (cmd === "run") {
    await handleRun(args.slice(1));
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}\nRun 'termos help' for usage`);
  process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
