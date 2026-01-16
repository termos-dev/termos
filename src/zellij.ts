import { execFile } from "child_process";
import { promisify } from "util";
import { buildShellCommand } from "./shell-utils.js";

const execFileAsync = promisify(execFile);

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
  env?: Record<string, string>
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
  const shell = process.env.SHELL || "sh";
  args.push("--", shell, "-lc", shellCommand);

  await execFileAsync("zellij", args);
}

export async function runTab(
  command: string,
  options: FloatingPaneOptions = {},
  env?: Record<string, string>
): Promise<void> {
  const name = options.name ?? "termos";
  const shellCommand = buildShellCommand(command, env);
  const shell = process.env.SHELL || "sh";

  const tabArgs = ["action", "new-tab", "--name", name];
  if (options.cwd) tabArgs.push("--cwd", options.cwd);
  await execFileAsync("zellij", tabArgs);
  try {
    await execFileAsync("zellij", ["action", "go-to-tab-name", name]);
  } catch {
    // ignore focus failures; run will still work in most cases
  }

  const runArgs = ["run", "--in-place", "--name", name];
  if (options.cwd) runArgs.push("--cwd", options.cwd);
  runArgs.push("--", shell, "-lc", shellCommand);
  await execFileAsync("zellij", runArgs);
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
  env?: Record<string, string>
): Promise<void> {
  const direction = options.direction ?? getOptimalSplitDirection();
  const args = ["run", "--direction", direction, "--stacked"];

  if (options.closeOnExit) args.push("--close-on-exit");
  if (options.name) args.push("--name", options.name);
  if (options.cwd) args.push("--cwd", options.cwd);

  const shellCommand = buildShellCommand(command, env);
  const shell = process.env.SHELL || "sh";
  args.push("--", shell, "-lc", shellCommand);

  await execFileAsync("zellij", args);
}
