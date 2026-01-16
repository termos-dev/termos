import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { normalizeSessionName } from "./runtime.js";
import { runFloatingPane, runTab, runSplitPane, getOptimalSplitDirection } from "./zellij.js";
import { shellEscape, buildMacOSTerminalCommand } from "./shell-utils.js";

const execFileAsync = promisify(execFile);

export type PositionPreset =
  | "floating"
  | "floating:center"
  | "floating:top-left"
  | "floating:top-right"
  | "floating:bottom-left"
  | "floating:bottom-right"
  | "split"
  | "split:right"
  | "split:down"
  | "tab";

export const VALID_POSITIONS: PositionPreset[] = [
  "floating",
  "floating:center",
  "floating:top-left",
  "floating:top-right",
  "floating:bottom-left",
  "floating:bottom-right",
  "split",
  "split:right",
  "split:down",
  "tab",
];

const FLOATING_PRESETS: Record<string, { x: string; y: string; width: string; height: string }> = {
  "floating":              { x: "68%", y: "5%",  width: "30%", height: "40%" },
  "floating:center":       { x: "35%", y: "30%", width: "30%", height: "40%" },
  "floating:top-left":     { x: "2%",  y: "5%",  width: "30%", height: "40%" },
  "floating:top-right":    { x: "68%", y: "5%",  width: "30%", height: "40%" },
  "floating:bottom-left":  { x: "2%",  y: "55%", width: "30%", height: "40%" },
  "floating:bottom-right": { x: "68%", y: "55%", width: "30%", height: "40%" },
};

export interface PaneRunOptions {
  name?: string;
  cwd?: string;
  position?: PositionPreset;
  closeOnExit?: boolean;
  heightPercent?: number;  // Override height (percentage of terminal)
}

export interface PaneHost {
  kind: "zellij" | "ghostty" | "mac-terminal";
  sessionName: string;
  supportsGeometry: boolean;
  run(command: string, options: PaneRunOptions, env?: Record<string, string>): Promise<void>;
  close?(name?: string): Promise<void>;
}

function resolveSessionName(cwd: string): { name: string; inZellij: boolean } {
  const zellijName = process.env.ZELLIJ_SESSION_NAME;
  if (zellijName && zellijName.trim().length > 0) {
    return { name: zellijName.trim(), inZellij: true };
  }

  // Session name is always derived from cwd
  const base = path.basename(cwd || process.cwd()) || "session";
  return { name: normalizeSessionName(base), inZellij: false };
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function findExecutable(name: string): string | undefined {
  const envPath = process.env.PATH ?? "";
  const entries = envPath.split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const fullPath = path.join(entry, name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && (stat.mode & 0o111)) {
        return fullPath;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function resolveGhosttyApp(): string | undefined {
  const appCandidates = [
    "/Applications/Ghostty.app",
    path.join(os.homedir(), "Applications", "Ghostty.app"),
  ];
  for (const candidate of appCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function createZellijHost(sessionName: string): PaneHost {
  return {
    kind: "zellij",
    sessionName,
    supportsGeometry: true,
    async run(command, options, env) {
      const position = options.position ?? "floating";

      if (position === "tab") {
        await runTab(command, { name: options.name, cwd: options.cwd }, env);
      } else if (position.startsWith("split")) {
        let direction: "right" | "down" | undefined;
        if (position === "split:right") direction = "right";
        else if (position === "split:down") direction = "down";
        // else "split" uses auto-detection
        await runSplitPane(command, {
          name: options.name,
          cwd: options.cwd,
          closeOnExit: options.closeOnExit,
          direction: direction ?? getOptimalSplitDirection(),
        }, env);
      } else {
        // floating presets
        const geometry = FLOATING_PRESETS[position] ?? FLOATING_PRESETS["floating"];
        const effectiveHeight = options.heightPercent
          ? String(options.heightPercent)
          : geometry.height;
        await runFloatingPane(command, {
          name: options.name,
          cwd: options.cwd,
          closeOnExit: options.closeOnExit,
          ...geometry,
          height: effectiveHeight,
        }, env);
      }
    },
  };
}

function createGhosttyHost(sessionName: string): PaneHost {
  const ghosttyExe = findExecutable("ghostty");
  const ghosttyApp = resolveGhosttyApp() ?? "Ghostty.app";
  return {
    kind: "ghostty",
    sessionName,
    supportsGeometry: false,
    async close(name?: string) {
      if (!name) return;
      // Close Ghostty window by title using AppleScript
      const script = `
tell application "Ghostty"
  repeat with w in windows
    if name of w contains "termos:${name}" then
      close w
      exit repeat
    end if
  end repeat
end tell`;
      try {
        await execFileAsync("osascript", ["-e", script]);
      } catch {
        // Ignore errors if window not found or already closed
      }
    },
    async run(command, options, env) {
      const name = options.name ?? "termos";
      const shellCommand = buildMacOSTerminalCommand(command, options, env);
      // Write to temp file with shebang and execute it using user's shell
      const tmpFile = `/tmp/termos-${Date.now()}.sh`;
      const userShell = process.env.SHELL || "/bin/sh";
      const scriptContent = `#!${userShell}
${shellCommand}
`;
      fs.writeFileSync(tmpFile, scriptContent, "utf8");
      fs.chmodSync(tmpFile, 0o755);
      if (ghosttyExe) {
        await execFileAsync(ghosttyExe, ["-e", tmpFile]);
      } else {
        await execFileAsync("open", ["-na", ghosttyApp, "--args", "-e", tmpFile]);
      }
      // Clean up after delay
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 2000);
    },
  };
}

function createMacTerminalHost(sessionName: string): PaneHost {
  const host: PaneHost = {
    kind: "mac-terminal",
    sessionName,
    supportsGeometry: false,
    async close(name?: string) {
      if (!name) return;
      // Close Terminal tab by custom title using AppleScript
      const script = `
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if custom title of t contains "termos:${name}" then
        close t
        return
      end if
    end repeat
  end repeat
end tell`;
      try {
        await execFileAsync("osascript", ["-e", script]);
      } catch {
        // Ignore errors if tab not found or already closed
      }
    },
    async run(command, options, env) {
      const name = options.name ?? "termos";
      const shellCommand = buildMacOSTerminalCommand(command, options, env);
      const scriptLines = [
        "tell application \"Terminal\"",
        "activate",
        "if (count of windows) is 0 then",
        "  do script \"\"",
        "end if",
        `set newTab to do script \"${escapeAppleScript(shellCommand)}\" in front window`,
        `set custom title of newTab to \"${escapeAppleScript(`termos:${name}`)}\"`,
        "set title displays custom title of newTab to true",
      ];
      scriptLines.push("end tell");
      await execFileAsync("osascript", ["-e", scriptLines.join("\n")]);
    },
  };
  return host;
}

export function selectPaneHost(cwd: string): PaneHost {
  const resolved = resolveSessionName(cwd);

  if (resolved.inZellij) {
    return createZellijHost(resolved.name);
  }

  if (process.platform === "darwin") {
    if (findExecutable("ghostty") || resolveGhosttyApp()) {
      return createGhosttyHost(resolved.name);
    }
    return createMacTerminalHost(resolved.name);
  }

  // Linux/Windows require Zellij
  throw new Error("termos must be run inside a Zellij session on Linux/Windows.");
}
