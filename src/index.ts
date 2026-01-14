#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { InteractionManager, type InteractionResult } from "./interaction-manager.js";
import { ensureEventsFile } from "./runtime.js";
import { selectPaneHost } from "./pane-hosts.js";
import { generateFullHelp, type FormSchema } from "@termosdev/shared";

const DEFAULT_GEOMETRY = {
  width: "40",
  height: "50",
  x: "60",
  y: "5",
};

function showRunHelp(): void {
  console.log(generateFullHelp());
}

function showHelp(): void {
  console.log(`
termos - Interactive UI runner for Claude Code (Zellij or macOS Terminal)

Usage:
  termos up                   Stream events (long-running)

  termos run <component>      Run an Ink component (built-in or custom .tsx)
  termos run -- <command>     Run a shell command in a floating pane

Built-in components: ask, confirm, checklist, code, diff, table, progress, mermaid, markdown, plan-viewer

Options:
  --width/--height/--x/--y   Pane geometry (0-100). Defaults to 40x50 @ x=60,y=5 for built-ins.
                            Required for custom components and commands on Zellij.
                            Ignored in macOS Terminal mode.
  -h, --help       Show this help
`);
}

async function handleUp(args: string[]): Promise<void> {
  if (args.includes("--json")) {
    console.error("Error: --json is not supported. 'termos up' always streams.");
    process.exit(1);
  }
  const host = selectPaneHost(process.cwd());
  const eventsFile = ensureEventsFile(host.sessionName);

  console.log("Termos up is running.");
  console.log("Streaming events for this session.");
  console.log("");
  console.log(generateFullHelp());

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

  let width: string | undefined;
  let height: string | undefined;
  let x: string | undefined;
  let y: string | undefined;
  const hasWait = args.includes("--wait");
  const hasNoWait = args.includes("--no-wait");
  const restArgs = args.filter(arg => arg !== "--wait" && arg !== "--no-wait");
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
  };
  for (let i = 0; i < restArgs.length; i++) {
    const arg = restArgs[i];
    if (arg === "--width" && restArgs[i + 1]) {
      width = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--width=")) {
      width = arg.slice(8);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--height" && restArgs[i + 1]) {
      height = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--height=")) {
      height = arg.slice(9);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--x" && restArgs[i + 1]) {
      x = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--x=")) {
      x = arg.slice(4);
      restArgs.splice(i, 1); i--;
    } else if (arg === "--y" && restArgs[i + 1]) {
      y = restArgs[i + 1];
      restArgs.splice(i, 2); i--;
    } else if (arg.startsWith("--y=")) {
      y = arg.slice(4);
      restArgs.splice(i, 1); i--;
    }
  }

  const sepIdx = restArgs.indexOf("--");
  const wait = hasWait ? true : (hasNoWait ? false : false);
  const emitRunError = (message: string) => {
    console.log(JSON.stringify({ action: "cancel", error: message }));
  };

  const parsePercentNumber = (value: string | undefined, name: string): number | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    const numeric = trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed;
    const num = Number(numeric);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      emitRunError(`Invalid ${name} "${value}". Use a number between 0 and 100.`);
      process.exit(1);
    }
    return num;
  };

  const parsePercent = (value: string | undefined, name: string): string | undefined => {
    const num = parsePercentNumber(value, name);
    return num === undefined ? undefined : `${num}%`;
  };

  const component = restArgs[0]?.toLowerCase();
  const isBuiltinComponent = sepIdx === -1 && (component === "ask" || !!builtinComponents[component ?? ""]);
  if (isBuiltinComponent) {
    if (width === undefined) width = DEFAULT_GEOMETRY.width;
    if (height === undefined) height = DEFAULT_GEOMETRY.height;
    if (x === undefined) x = DEFAULT_GEOMETRY.x;
    if (y === undefined) y = DEFAULT_GEOMETRY.y;
  }

  const host = selectPaneHost(process.cwd());
  const paneWidth = parsePercent(width, "width");
  const paneHeight = parsePercent(height, "height");
  const paneX = parsePercent(x, "x");
  const paneY = parsePercent(y, "y");

  if (host.supportsGeometry) {
    if (paneWidth === undefined || paneHeight === undefined || paneX === undefined || paneY === undefined) {
      emitRunError("Pane geometry required for custom components and commands: --width --height --x --y (0-100).");
      process.exit(1);
    }
  }

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
      title: cmdArgs["title"],
      timeoutMs: wait ? 300000 : 0,
      width: paneWidth,
      height: paneHeight,
      x: paneX,
      y: paneY,
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

  if (sepIdx !== -1) {
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
    if (!Object.keys(inkArgs).length) inkArgs = undefined;
  }

  ensureEventsFile(host.sessionName);
  const im = new InteractionManager({ cwd: process.cwd(), host });
  const componentName = sepIdx !== -1 ? undefined : component;
  const id = await im.create({
    inkFile,
    inkArgs,
    command,
    timeoutMs: wait ? 300000 : 0,
    width: paneWidth,
    height: paneHeight,
    x: paneX,
    y: paneY,
    component: componentName,
    isCommand: sepIdx !== -1,
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
