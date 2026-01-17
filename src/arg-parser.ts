/**
 * Reusable argument parsing utility
 * Extracts flags from args array, mutating it to remove parsed flags
 */

export interface ParsedFlags {
  [key: string]: string | undefined;
}

export interface FlagSpec {
  name: string;
  type?: "string" | "number";
}

/**
 * Extract known flags from args array, mutating it to remove parsed flags.
 * Supports both --flag value and --flag=value syntax.
 * Stops at "--" separator.
 */
export function extractFlags(args: string[], specs: FlagSpec[]): ParsedFlags {
  const result: ParsedFlags = {};
  const flagNames = new Set(specs.map(s => s.name));

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;

    for (const spec of specs) {
      const flagName = `--${spec.name}`;
      const eqPrefix = `${flagName}=`;

      if (arg === flagName && args[i + 1] && !args[i + 1].startsWith("--")) {
        result[spec.name] = args[i + 1];
        args.splice(i, 2);
        i--;
        break;
      } else if (arg.startsWith(eqPrefix)) {
        result[spec.name] = arg.slice(eqPrefix.length);
        args.splice(i, 1);
        i--;
        break;
      }
    }
  }

  return result;
}

/**
 * Extract component-specific args (everything after component name)
 * Returns key-value pairs from --key value or --key=value patterns
 */
export function extractComponentArgs(
  args: string[],
  startIndex: number = 1
): Record<string, string> {
  const result: Record<string, string> = {};

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    const eqIdx = key.indexOf("=");

    if (eqIdx > 0) {
      result[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
    } else if (args[i + 1] && !args[i + 1].startsWith("-")) {
      result[key] = args[++i];
    }
  }

  return result;
}
