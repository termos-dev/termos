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
