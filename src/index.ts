#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { InteractionManager, type InteractionResult } from "./interaction-manager.js";
import { ensureEventsFile, getEventsFilePath } from "./runtime.js";
import { selectPaneHost, VALID_POSITIONS, type PositionPreset } from "./pane-hosts.js";
import { generateFullHelp, componentSchemas, normalizeFormSchema, type FormSchema } from "@termosdev/shared";
import { getComponentHeight, rowsToPercent } from "./height-calculator.js";
import { loadMergedInstructions } from "./instructions-loader.js";
import { extractFlags } from "./arg-parser.js";

function showRunHelp(): void {
  console.log(generateFullHelp());
}

function showHelp(): void {
  console.log(`
termos - Interactive UI runner for Claude Code (Zellij, Ghostty, or macOS Terminal)

Usage:
  termos run --title <text> --position <preset> <component>            Run an Ink component
  termos run --title <text> --position <preset> --cmd "<command>"      Run a shell command
  termos run --title <text> --position <preset> --cmd-file <path>      Run command from file
  termos run --title <text> --position <preset> -- <command>           Run command (passthrough)

  termos wait <id> [--timeout <seconds>]           Wait for interaction result (default: 300s)
  termos result [<id>]                             Get result(s) - all if no ID provided

Built-in components: ask, confirm, checklist, code, edit, diff, table, progress, mermaid, markdown,
                     plan-viewer, chart, select, tree, json, gauge

Options:
  --title <text>        Title (required)
  --cmd "<string>"      Inline shell command (supports &&, |, ||, etc.)
  --cmd-file <path>     Read command from file
  --position <preset>   Pane position preset (required)
                        Floating: floating, floating:center, floating:top-left, etc.
                          Size modifiers: :small, :medium, :large (e.g., floating:center:large)
                        Split (Zellij): split, split:right, split:down
                        Tab: tab

  -h, --help            Show this help

Workflow:
  1. termos run ... → Returns {"id": "...", "status": "started"}
  2. User interacts with pane
  3. termos wait <id> → Returns result when complete

Examples:
  termos run --title "Confirm" --position floating confirm --prompt "Delete files?"
  termos wait interaction-1-123456789 --timeout 60

Live Data (use shell's watch command):
  termos run --title "Changes" --position floating --cmd "watch -n1 -c 'git diff --color=always'"
  termos run --title "Logs" --position split:down --cmd "tail -f /var/log/app.log"
`);

  const instructions = loadMergedInstructions(process.cwd());
  if (instructions) {
    console.log("\n## Project Instructions\n");
    console.log(instructions);
  }
}

async function handleRun(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    showRunHelp();
    process.exit(0);
  }

  let title: string | undefined;
  let position: PositionPreset | undefined;
  const hasWait = args.includes("--wait");
  const hasNoWait = args.includes("--no-wait");
  const restArgs = args.filter(
    arg => arg !== "--wait" && arg !== "--no-wait"
  );

  let cmdValue: string | undefined;
  let cmdFileValue: string | undefined;
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
  // Extract flags using reusable parser
  const knownCliFlags = ["title", "position", "cmd", "cmd-file"];
  const flags = extractFlags(restArgs, knownCliFlags.map(name => ({ name })));
  title = flags.title;
  position = flags.position as PositionPreset | undefined;
  cmdValue = flags.cmd;
  cmdFileValue = flags["cmd-file"];

  const sepIdx = restArgs.indexOf("--");
  const wait = hasWait;
  const emitRunError = (message: string) => {
    console.log(JSON.stringify({ action: "cancel", error: message }));
  };

  // Check for unknown CLI options (flags before component name or -- separator)
  const firstArgIdx = restArgs.findIndex(arg => !arg.startsWith("--") || arg === "--");
  for (let i = 0; i < (firstArgIdx === -1 ? restArgs.length : firstArgIdx); i++) {
    const arg = restArgs[i];
    if (arg.startsWith("--") && arg !== "--") {
      const flagName = arg.slice(2).split("=")[0];
      const validFlags = knownCliFlags.map(f => `--${f}`).join(", ");
      emitRunError(`Unknown CLI option --${flagName}. Valid options: ${validFlags}`);
      process.exit(1);
    }
  }

  // Require --position
  if (!position) {
    emitRunError("--position is required.");
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

  const host = selectPaneHost(process.cwd());

  // Ensure session directory exists (no longer requires `termos up`)
  ensureEventsFile(host.sessionName);

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

    if (cmdArgs["file"]) {
      emitRunError("--file is not supported for ask. Use --questions '<json>'");
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
          emitRunError("Invalid JSON in --options/--choices");
          process.exit(1);
        }
      }
      questionsArg = JSON.stringify([question]);
    }

    if (!questionsArg) {
      emitRunError("--questions or --prompt is required for ask component");
      process.exit(1);
    }


    let schema: FormSchema;
    try {
      const parsed = JSON.parse(questionsArg);
      schema = normalizeFormSchema(parsed);
    } catch {
      emitRunError("Invalid JSON in --questions");
      process.exit(1);
    }

    ensureEventsFile(host.sessionName);
    const im = new InteractionManager({ cwd: process.cwd(), host });
    const id = await im.create({
      schema,
      title: titleValue,
      timeoutMs: wait ? 300000 : 0,
      position: position,
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

  // Special handling for `edit` - runs TUI editor directly in pane
  if (component === "edit") {
    // Parse edit args
    const editArgs: Record<string, string> = {};
    for (let i = 1; i < restArgs.length; i++) {
      const arg = restArgs[i];
      if (arg.startsWith("--")) {
        const key = arg.slice(2);
        const eqIdx = key.indexOf("=");
        if (eqIdx > 0) editArgs[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
        else if (restArgs[i + 1]?.charAt(0) !== "-") editArgs[key] = restArgs[++i];
      }
    }

    const filePath = editArgs["file"];
    if (!filePath) {
      emitRunError("--file is required for edit component");
      process.exit(1);
    }

    const editorTemplate = editArgs["editor"];
    if (!editorTemplate) {
      emitRunError("--editor is required for edit component (e.g. 'nvim +{line}', 'vim +{line}')");
      process.exit(1);
    }

    const lineNum = editArgs["line"] || "1";

    // Replace {line} and {file} placeholders
    let editorCmd = editorTemplate.replace("{line}", lineNum).replace("{file}", filePath);

    // If command doesn't contain the file path, append it
    if (!editorCmd.includes(filePath)) {
      editorCmd = `${editorCmd} "${filePath}"`;
    }

    // Run with edit-wrapper (no "Press Enter" prompt) and closeOnExit
    ensureEventsFile(host.sessionName);
    const im = new InteractionManager({ cwd: process.cwd(), host });
    const id = await im.create({
      command: editorCmd,
      title: titleValue,
      timeoutMs: wait ? 300000 : 0,
      position: position,
      component: "edit",
      isCommand: true,
      closeOnExit: true,
      wrapperTemplate: "edit-wrapper",
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

  // Validate component args against schema
  if (!isCommandMode && component) {
    const schema = componentSchemas[component];
    if (schema?.args) {
      // Check required args
      for (const [argName, argDef] of Object.entries(schema.args)) {
        if ((argDef as { required?: boolean }).required && !inkArgs?.[argName]) {
          return emitRunError(`Missing required argument: --${argName}`);
        }
      }
      // Fail on unknown args for built-in components
      if (inkArgs) {
        const knownArgs = new Set(Object.keys(schema.args));
        for (const argName of Object.keys(inkArgs)) {
          if (!knownArgs.has(argName) && argName !== 'title') {
            const validArgs = Array.from(knownArgs).map(a => `--${a}`).join(', ');
            return emitRunError(
              `Unknown argument --${argName} for component '${component}'. Valid args: ${validArgs}`
            );
          }
        }
      }
    }
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
    position: position,
    component: componentName,
    isCommand: isCommandMode,
    heightPercent,
  });

  if (wait) {
    const result = await new Promise<InteractionResult>(resolve => {
      im.on("interactionComplete", (iid: string, r: InteractionResult) => { if (iid === id) resolve(r); });
    });
    console.log(JSON.stringify(result));
  } else {
    console.log(JSON.stringify({ id, status: "started" }));
  }
}

/**
 * Wait for an interaction result (blocking)
 */
async function handleWait(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: termos wait <interaction-id> [--timeout <seconds>]");
    process.exit(1);
  }

  // Parse timeout (default 300 seconds = 5 minutes)
  let timeoutSec = 300;
  const timeoutIdx = args.indexOf("--timeout");
  if (timeoutIdx !== -1 && args[timeoutIdx + 1]) {
    timeoutSec = parseInt(args[timeoutIdx + 1], 10);
    if (isNaN(timeoutSec) || timeoutSec <= 0) {
      console.error("Invalid timeout value");
      process.exit(1);
    }
  }

  const host = selectPaneHost(process.cwd());
  const eventsFile = getEventsFilePath(host.sessionName);
  const startTime = Date.now();
  const timeoutMs = timeoutSec * 1000;
  const pollInterval = 500;

  // Poll for result
  while (Date.now() - startTime < timeoutMs) {
    try {
      if (fs.existsSync(eventsFile)) {
        const content = fs.readFileSync(eventsFile, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        // Search from end (most recent first)
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const event = JSON.parse(lines[i]);
            if (event.type === "result" && event.id === id) {
              console.log(JSON.stringify(event));
              process.exit(0);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // Ignore read errors, keep polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Timeout - output to stdout for consistent JSON parsing
  console.log(JSON.stringify({ error: "timeout", id, timeoutSec }));
  process.exit(1);
}

/**
 * Get interaction result (non-blocking)
 * If no ID provided, returns all results
 */
function handleResult(args: string[]): void {
  const id = args[0];
  const host = selectPaneHost(process.cwd());
  const eventsFile = getEventsFilePath(host.sessionName);

  try {
    if (fs.existsSync(eventsFile)) {
      const content = fs.readFileSync(eventsFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      if (!id) {
        // No ID provided - return all results
        const results: unknown[] = [];
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === "result") {
              results.push(event);
            }
          } catch {
            // Skip malformed lines
          }
        }
        console.log(JSON.stringify({ results }));
        process.exit(0);
      }

      // Search for specific ID from end (most recent first)
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(lines[i]);
          if (event.type === "result" && event.id === id) {
            console.log(JSON.stringify(event));
            process.exit(0);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // No result found
  if (!id) {
    console.log(JSON.stringify({ results: [] }));
  } else {
    console.log(JSON.stringify({ status: "pending", id }));
  }
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    showHelp();
    process.exit(0);
  }

  if (cmd === "run") {
    await handleRun(args.slice(1));
    process.exit(0);
  }

  if (cmd === "wait") {
    await handleWait(args.slice(1));
    return;
  }

  if (cmd === "result") {
    handleResult(args.slice(1));
    return;
  }

  console.error(`Unknown command: ${cmd}\nRun 'termos help' for usage`);
  process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
