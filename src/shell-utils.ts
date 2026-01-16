/**
 * Shared shell utility functions
 */

/**
 * Escape a string for safe use in shell commands (single-quote escaping)
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build a shell command with optional environment variable exports
 */
export function buildShellCommand(command: string, env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) {
    return command;
  }
  const envParts = Object.entries(env).map(([key, value]) => `export ${key}=${shellEscape(value)};`);
  return `${envParts.join(" ")} ${command}`;
}

export interface MacOSTerminalCommandOptions {
  cwd?: string;
  name?: string;
  closeOnExit?: boolean;
}

/**
 * Build a command string for macOS terminal hosts (Ghostty/Terminal.app)
 * Includes clear screen, title setting, and close behavior
 */
export function buildMacOSTerminalCommand(
  command: string,
  options: MacOSTerminalCommandOptions,
  env?: Record<string, string>
): string {
  const cwd = options.cwd ?? process.cwd();
  const name = options.name ?? "termos";
  const clearCommand = `printf '\\033[3J\\033[H\\033[2J'`;
  const titleCommand = `printf '\\033]0;termos:${name}\\007'`;
  const closeNote = options.closeOnExit
    ? `; printf '\\n[termos] Pane closed. Please close this tab/window.\\n'`
    : `; printf '\\n[termos] Press Enter to close...\\n'; read _`;
  return buildShellCommand(
    `cd ${shellEscape(cwd)}; ${clearCommand}; ${titleCommand}; ${command}${closeNote}`,
    env
  );
}
