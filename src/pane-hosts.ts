import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { pathToSessionName } from "./runtime.js";
import { runFloatingPane, runTab, runSplitPane, getOptimalSplitDirection } from "./zellij.js";
import { shellEscape, buildMacOSTerminalCommand } from "./shell-utils.js";

const execFileAsync = promisify(execFile);

// Base position presets (without size modifiers)
export type BasePosition =
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

// Size modifiers for floating positions
export type SizeModifier = "small" | "medium" | "large";

// PositionPreset can now be a base position or base:size (e.g., "floating:center:large")
export type PositionPreset = string;

const BASE_POSITIONS: BasePosition[] = [
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

// For backwards compatibility, export common positions
export const VALID_POSITIONS: string[] = [
  ...BASE_POSITIONS,
  // Also include common size combinations for documentation
  "floating:small", "floating:medium", "floating:large",
  "floating:center:small", "floating:center:medium", "floating:center:large",
];

// Size presets: small (current default), medium, large
const SIZE_PRESETS: Record<SizeModifier, { width: string; height: string }> = {
  small:  { width: "30%", height: "40%" },
  medium: { width: "45%", height: "55%" },
  large:  { width: "60%", height: "70%" },
};

// Base floating geometry (x, y positions only - size comes from SIZE_PRESETS)
const FLOATING_BASE: Record<string, { x: string; y: string }> = {
  "floating":              { x: "68%", y: "5%" },
  "floating:center":       { x: "27%", y: "22%" },  // Adjusted for centered look with different sizes
  "floating:top-left":     { x: "2%",  y: "5%" },
  "floating:top-right":    { x: "68%", y: "5%" },
  "floating:bottom-left":  { x: "2%",  y: "55%" },
  "floating:bottom-right": { x: "68%", y: "55%" },
};

// Legacy FLOATING_PRESETS for backwards compatibility (uses small size)
const FLOATING_PRESETS: Record<string, { x: string; y: string; width: string; height: string }> = {
  "floating":              { ...FLOATING_BASE["floating"], ...SIZE_PRESETS.small },
  "floating:center":       { x: "35%", y: "30%", ...SIZE_PRESETS.small },
  "floating:top-left":     { ...FLOATING_BASE["floating:top-left"], ...SIZE_PRESETS.small },
  "floating:top-right":    { ...FLOATING_BASE["floating:top-right"], ...SIZE_PRESETS.small },
  "floating:bottom-left":  { ...FLOATING_BASE["floating:bottom-left"], ...SIZE_PRESETS.small },
  "floating:bottom-right": { ...FLOATING_BASE["floating:bottom-right"], ...SIZE_PRESETS.small },
};

export interface ParsedPosition {
  type: "floating" | "split" | "tab";
  base: string;
  size?: SizeModifier;
  geometry?: { x: string; y: string; width: string; height: string };
  splitDirection?: "right" | "down";
}

/**
 * Parse a position string like "floating:center:large" into its components
 */
export function parsePosition(position: string): ParsedPosition {
  // Handle tab
  if (position === "tab") {
    return { type: "tab", base: "tab" };
  }

  // Handle split positions
  if (position.startsWith("split")) {
    let direction: "right" | "down" | undefined;
    if (position === "split:right") direction = "right";
    else if (position === "split:down") direction = "down";
    return { type: "split", base: position, splitDirection: direction };
  }

  // Handle floating positions with optional size modifier
  // Format: floating[:location][:size]
  // Examples: "floating", "floating:center", "floating:center:large", "floating:large"
  const parts = position.split(":");
  const sizeModifiers: SizeModifier[] = ["small", "medium", "large"];

  let basePosition = "floating";
  let size: SizeModifier = "small"; // Default size

  if (parts.length === 1) {
    // "floating"
    basePosition = "floating";
  } else if (parts.length === 2) {
    // "floating:center" or "floating:large"
    if (sizeModifiers.includes(parts[1] as SizeModifier)) {
      basePosition = "floating";
      size = parts[1] as SizeModifier;
    } else {
      basePosition = position; // "floating:center"
    }
  } else if (parts.length === 3) {
    // "floating:center:large"
    basePosition = `${parts[0]}:${parts[1]}`;
    if (sizeModifiers.includes(parts[2] as SizeModifier)) {
      size = parts[2] as SizeModifier;
    }
  }

  // Get base geometry (position) - fall back to default floating if not found
  const baseGeom = FLOATING_BASE[basePosition] ?? FLOATING_BASE["floating"];
  const sizeGeom = SIZE_PRESETS[size];

  // For center position, adjust x/y based on size for true centering
  let x = baseGeom.x;
  let y = baseGeom.y;
  if (basePosition === "floating:center") {
    // Calculate centered position based on size
    const widthNum = parseInt(sizeGeom.width);
    const heightNum = parseInt(sizeGeom.height);
    x = `${Math.round((100 - widthNum) / 2)}%`;
    y = `${Math.round((100 - heightNum) / 2)}%`;
  }

  return {
    type: "floating",
    base: basePosition,
    size,
    geometry: { x, y, ...sizeGeom },
  };
}

/**
 * Validate a position string
 */
export function isValidPosition(position: string): boolean {
  if (position === "tab") return true;
  if (position.startsWith("split")) {
    return ["split", "split:right", "split:down"].includes(position);
  }
  // For floating, just check it starts with "floating"
  return position.startsWith("floating");
}

export interface PaneRunOptions {
  name?: string;
  cwd?: string;
  position?: PositionPreset;
  closeOnExit?: boolean;
  heightPercent?: number;  // Override height (percentage of terminal)
  skipCloseNote?: boolean; // Skip adding close message/prompt (when wrapper handles it)
}

export interface PaneHost {
  kind: "zellij" | "ghostty" | "mac-terminal";
  sessionName: string;
  supportsGeometry: boolean;
  showsPaneTitle: boolean;  // true if host shows title bar above content (Zellij only)
  run(command: string, options: PaneRunOptions, env?: Record<string, string>): Promise<void>;
  close?(name?: string): Promise<void>;
}

function resolveSessionName(cwd: string): { name: string; inZellij: boolean } {
  const zellijName = process.env.ZELLIJ_SESSION_NAME;
  if (zellijName && zellijName.trim().length > 0) {
    return { name: zellijName.trim(), inZellij: true };
  }

  // Session name derived from full cwd path (like Claude's ~/.claude/projects/)
  return { name: pathToSessionName(cwd || process.cwd()), inZellij: false };
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
    showsPaneTitle: true,  // Zellij shows pane title bar directly above content
    async run(command, options, env) {
      const position = options.position ?? "floating";
      const parsed = parsePosition(position);

      if (parsed.type === "tab") {
        await runTab(command, { name: options.name, cwd: options.cwd }, env, sessionName);
      } else if (parsed.type === "split") {
        await runSplitPane(command, {
          name: options.name,
          cwd: options.cwd,
          closeOnExit: options.closeOnExit,
          direction: parsed.splitDirection ?? getOptimalSplitDirection(),
        }, env, sessionName);
      } else {
        // Floating with size support
        const geometry = parsed.geometry!;
        const effectiveHeight = options.heightPercent
          ? String(options.heightPercent)
          : geometry.height;
        await runFloatingPane(command, {
          name: options.name,
          cwd: options.cwd,
          closeOnExit: options.closeOnExit,
          ...geometry,
          height: effectiveHeight,
        }, env, sessionName);
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
    showsPaneTitle: false,  // Window title is separate (centered), no visual overlap
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
      const shellCommand = buildMacOSTerminalCommand(command, {
        ...options,
        name,
      }, env);
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
      // Clean up after delay (longer delay to ensure script has time to start)
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 10000);
    },
  };
}

function createMacTerminalHost(sessionName: string): PaneHost {
  const host: PaneHost = {
    kind: "mac-terminal",
    sessionName,
    supportsGeometry: false,
    showsPaneTitle: false,  // Tab title is separate, helps identify
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
      const shellCommand = buildMacOSTerminalCommand(command, {
        ...options,
        name,
      }, env);
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

  // Use Zellij if running inside it (ZELLIJ_SESSION_NAME is set)
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
