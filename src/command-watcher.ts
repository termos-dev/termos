/**
 * Command watcher for live data updates
 *
 * NOTE: This module intentionally uses child_process.exec() because --watch-cmd
 * is designed to run arbitrary shell commands with pipes, redirects, and shell
 * operators (e.g., "wc -l *.ts | awk '{print $1}'"). The command string comes
 * from the user's CLI input, not from untrusted external sources.
 */

import { exec } from "child_process";
import { writeFileSync, renameSync } from "fs";

export type ParseMode = "number" | "json" | "lines" | "raw" | "auto";

export interface CommandWatcherOptions {
  cmd: string;
  interval: number;
  parse: ParseMode;
  outputFile: string;
  componentType?: string;
  componentArgs?: Record<string, string>;
  onError?: (error: Error) => void;
}

/**
 * Parse command output based on parse mode
 */
function parseOutput(output: string, mode: ParseMode): unknown {
  const trimmed = output.trim();

  if (mode === "auto") {
    // Try to auto-detect the format
    // Check if it's a number
    const num = parseFloat(trimmed);
    if (!isNaN(num) && trimmed.match(/^-?\d+\.?\d*$/)) {
      return { value: num };
    }

    // Check if it's JSON
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON, continue
      }
    }

    // Check if it's multiple lines
    if (trimmed.includes("\n")) {
      const lines = trimmed.split("\n").filter(l => l.trim());
      return lines.map((line, i) => ({ label: line.trim(), value: i + 1 }));
    }

    // Default to raw string
    return { value: trimmed };
  }

  switch (mode) {
    case "number": {
      const num = parseFloat(trimmed);
      return { value: isNaN(num) ? 0 : num };
    }
    case "json":
      try {
        return JSON.parse(trimmed);
      } catch {
        return { error: "Invalid JSON", raw: trimmed };
      }
    case "lines": {
      const lines = trimmed.split("\n").filter(l => l.trim());
      return lines.map((line, i) => ({ label: line.trim(), value: i + 1 }));
    }
    case "raw":
    default:
      return { value: trimmed };
  }
}

/**
 * Format parsed data for specific component types
 */
function formatForComponent(
  data: unknown,
  componentType?: string,
  componentArgs?: Record<string, string>
): unknown {
  // If data is already well-formed, return it
  if (Array.isArray(data)) {
    return data;
  }

  const obj = data as Record<string, unknown>;

  // For gauge component with simple value
  if (componentType === "gauge" && typeof obj.value === "number") {
    return {
      value: obj.value,
      label: componentArgs?.label || "",
      unit: componentArgs?.unit || "",
      min: componentArgs?.min ? parseFloat(componentArgs.min) : 0,
      max: componentArgs?.max ? parseFloat(componentArgs.max) : 100,
    };
  }

  // For chart with simple value - convert to single bar
  if (componentType === "chart" && typeof obj.value === "number") {
    return [{ label: componentArgs?.label || "Value", value: obj.value }];
  }

  return data;
}

/**
 * Execute command and return output.
 * Uses exec() intentionally to support shell features (pipes, etc.)
 */
function executeCommand(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // exec is used intentionally here - see module comment
    exec(cmd, { shell: "/bin/sh" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Start watching a command and writing output to a file
 * Returns a cleanup function to stop the watcher
 */
export function startCommandWatcher(options: CommandWatcherOptions): () => void {
  const { cmd, interval, parse, outputFile, componentType, componentArgs, onError } = options;

  let running = true;
  let timeoutId: NodeJS.Timeout | null = null;

  const runCommand = async () => {
    if (!running) return;

    try {
      const output = await executeCommand(cmd);
      const parsed = parseOutput(output, parse);
      const formatted = formatForComponent(parsed, componentType, componentArgs);

      // Atomic write: write to temp file then rename
      const tempPath = outputFile + '.tmp';
      writeFileSync(tempPath, JSON.stringify(formatted, null, 2));
      renameSync(tempPath, outputFile);
    } catch (error) {
      if (onError && error instanceof Error) {
        onError(error);
      }
      // Write error state to file (atomic)
      try {
        const tempPath = outputFile + '.tmp';
        writeFileSync(tempPath, JSON.stringify({ error: String(error), value: 0 }));
        renameSync(tempPath, outputFile);
      } catch { /* ignore write errors */ }
    }

    if (running) {
      timeoutId = setTimeout(runCommand, interval);
    }
  };

  // Run immediately, then on interval
  runCommand();

  // Return cleanup function
  return () => {
    running = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}
