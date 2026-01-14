import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { normalizeSessionName } from "./runtime.js";
import { runFloatingPane } from "./zellij.js";

const execFileAsync = promisify(execFile);

export interface PaneRunOptions {
  name?: string;
  cwd?: string;
  width?: string;
  height?: string;
  x?: string;
  y?: string;
  closeOnExit?: boolean;
}

export interface PaneHost {
  kind: "zellij" | "mac-terminal";
  sessionName: string;
  supportsGeometry: boolean;
  run(command: string, options: PaneRunOptions, env?: Record<string, string>): Promise<void>;
  close?(name?: string): Promise<void>;
}

function resolveSessionName(cwd: string, override?: string): { name: string; inZellij: boolean } {
  const zellijName = process.env.ZELLIJ_SESSION_NAME;
  if (zellijName && zellijName.trim().length > 0) {
    return { name: zellijName.trim(), inZellij: true };
  }

  const explicit = override ?? process.env.TERMOS_SESSION_NAME;
  if (explicit && explicit.trim().length > 0) {
    return { name: explicit.trim(), inZellij: false };
  }

  const base = path.basename(cwd || process.cwd()) || "session";
  return { name: normalizeSessionName(base), inZellij: false };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildShellCommand(command: string, env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) {
    return command;
  }
  const envParts = Object.entries(env).map(([key, value]) => `${key}=${shellEscape(value)}`);
  return `env ${envParts.join(" ")} ${command}`;
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function createZellijHost(sessionName: string): PaneHost {
  return {
    kind: "zellij",
    sessionName,
    supportsGeometry: true,
    async run(command, options, env) {
      await runFloatingPane(command, options, env);
    },
  };
}

function createMacTerminalHost(sessionName: string): PaneHost {
  const host: PaneHost = {
    kind: "mac-terminal",
    sessionName,
    supportsGeometry: false,
    async run(command, options, env) {
      const cwd = options.cwd ?? process.cwd();
      const name = options.name ?? "termos";
      const titleCommand = `printf '\\033]0;termos:${name}\\007'`;
      const shellCommand = buildShellCommand(`cd ${shellEscape(cwd)}; ${titleCommand}; ${command}`, env);
      const script = `tell application \"Terminal\" to do script \"${escapeAppleScript(shellCommand)}\"`;
      await execFileAsync("osascript", ["-e", "tell application \"Terminal\" to activate", "-e", script]);
    },
    async close(name) {
      if (!name) return;
      const target = `termos:${name}`;
      const script = [
        "tell application \"Terminal\"",
        "repeat with w in windows",
        "repeat with t in tabs of w",
        `if (name of t) contains \"${escapeAppleScript(target)}\" then`,
        "close t",
        "return",
        "end if",
        "end repeat",
        "end repeat",
        "end tell",
      ].join("\n");
      await execFileAsync("osascript", ["-e", script]);
    },
  };
  return host;
}

export function selectPaneHost(cwd: string, sessionNameOverride?: string): PaneHost {
  const resolved = resolveSessionName(cwd, sessionNameOverride);
  if (resolved.inZellij) {
    return createZellijHost(resolved.name);
  }

  if (process.platform === "darwin") {
    return createMacTerminalHost(resolved.name);
  }

  throw new Error("termos must be run inside a Zellij session on this platform.");
}
