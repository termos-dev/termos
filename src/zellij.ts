import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildShellCommand } from "./shell-utils.js";

const execFileAsync = promisify(execFile);

/**
 * Write a shell script to a temp file and return its path.
 * This allows running commands in an interactive shell context with proper TTY.
 */
function writeTempScript(shellCommand: string): string {
  const shell = process.env.SHELL || "/bin/sh";
  const tempFile = path.join(os.tmpdir(), `termos-pane-${Date.now()}.sh`);
  const scriptContent = `#!${shell}
${shellCommand}
`;
  fs.writeFileSync(tempFile, scriptContent, { mode: 0o755 });
  return tempFile;
}

/**
 * Schedule cleanup of a temp script file after a delay.
 * Zellij run returns before the script starts, so we need to wait.
 */
function scheduleScriptCleanup(scriptPath: string, delayMs: number = 10000): void {
  setTimeout(() => {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  }, delayMs);
}

/**
 * Write a KDL layout file for creating a tab with a command.
 * This ensures atomic tab creation - the command runs in the new tab only,
 * avoiding race conditions that could affect other panes (like Claude's).
 * Includes tab-bar and status-bar to match Zellij's default layout.
 */
function writeTempLayout(shellCommand: string, cwd?: string): string {
  const tempFile = path.join(os.tmpdir(), `termos-layout-${Date.now()}.kdl`);
  const shell = process.env.SHELL || "/bin/sh";

  // Escape double quotes and backslashes for KDL string
  const escapedCommand = shellCommand.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const cwdLine = cwd ? `        cwd "${cwd}"\n` : "";

  // Include tab-bar and status-bar to match Zellij's default layout
  const layoutContent = `layout {
    pane size=1 borderless=true {
        plugin location="zellij:tab-bar"
    }
    pane command="${shell}" {
        args "-c" "${escapedCommand}"
${cwdLine}    }
    pane size=1 borderless=true {
        plugin location="zellij:status-bar"
    }
}`;

  fs.writeFileSync(tempFile, layoutContent, { mode: 0o644 });
  return tempFile;
}

interface FloatingPaneOptions {
  name?: string;
  width?: string;
  height?: string;
  x?: string;
  y?: string;
  closeOnExit?: boolean;
  cwd?: string;
}

export async function runFloatingPane(
  command: string,
  options: FloatingPaneOptions = {},
  env?: Record<string, string>,
  sessionName?: string
): Promise<void> {
  const args = ["run", "--floating", "--pinned", "true"];

  if (options.closeOnExit) args.push("--close-on-exit");
  if (options.name) args.push("--name", options.name);
  if (options.cwd) args.push("--cwd", options.cwd);
  if (options.width) args.push("--width", options.width);
  if (options.height) args.push("--height", options.height);
  if (options.x) args.push("--x", options.x);
  if (options.y) args.push("--y", options.y);

  const shellCommand = buildShellCommand(command, env);
  // Write to temp script and execute directly to ensure proper TTY/raw mode for Ink
  const scriptPath = writeTempScript(shellCommand);
  args.push("--", scriptPath);

  // Pass session name via env var if running from outside the session
  const execEnv = sessionName ? { ...process.env, ZELLIJ_SESSION_NAME: sessionName } : undefined;
  await execFileAsync("zellij", args, execEnv ? { env: execEnv } : undefined);

  // Schedule cleanup after the script has had time to start
  scheduleScriptCleanup(scriptPath);
}

export async function runTab(
  command: string,
  options: FloatingPaneOptions = {},
  env?: Record<string, string>,
  sessionName?: string
): Promise<void> {
  const name = options.name ?? "termos";
  const shellCommand = buildShellCommand(command, env);

  // Pass session name via env var if running from outside the session
  const execEnv = sessionName ? { ...process.env, ZELLIJ_SESSION_NAME: sessionName } : undefined;
  const execOptions = execEnv ? { env: execEnv } : undefined;

  // Create a KDL layout file with the command - this is atomic and safe.
  // Unlike the previous --in-place approach, this cannot affect other panes
  // even if focus is not on the expected tab.
  const layoutPath = writeTempLayout(shellCommand, options.cwd);

  // Atomic operation: create tab with layout (command runs immediately in new tab)
  const tabArgs = ["action", "new-tab", "--layout", layoutPath, "--name", name];
  await execFileAsync("zellij", tabArgs, execOptions);

  // Schedule cleanup after the layout file has been read
  scheduleScriptCleanup(layoutPath);
}

interface SplitPaneOptions {
  name?: string;
  direction?: "right" | "down";
  closeOnExit?: boolean;
  cwd?: string;
}

interface PaneDimensions {
  columns: number;
  rows: number;
}

function getCurrentPaneDimensions(): PaneDimensions {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

export function getOptimalSplitDirection(): "right" | "down" {
  const dims = getCurrentPaneDimensions();
  return dims.rows > dims.columns ? "down" : "right";
}

export async function runSplitPane(
  command: string,
  options: SplitPaneOptions = {},
  env?: Record<string, string>,
  sessionName?: string
): Promise<void> {
  const direction = options.direction ?? getOptimalSplitDirection();
  const args = ["run", "--direction", direction];

  if (options.closeOnExit) args.push("--close-on-exit");
  if (options.name) args.push("--name", options.name);
  if (options.cwd) args.push("--cwd", options.cwd);

  const shellCommand = buildShellCommand(command, env);
  // Write to temp script and execute directly to ensure proper TTY/raw mode for Ink
  const scriptPath = writeTempScript(shellCommand);
  args.push("--", scriptPath);

  // Pass session name via env var if running from outside the session
  const execEnv = sessionName ? { ...process.env, ZELLIJ_SESSION_NAME: sessionName } : undefined;
  await execFileAsync("zellij", args, execEnv ? { env: execEnv } : undefined);

  // Schedule cleanup after the script has had time to start
  scheduleScriptCleanup(scriptPath);
}
