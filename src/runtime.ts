import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function getRuntimeRoot(): string {
  const override = process.env.TERMOS_RUNTIME_DIR;
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(os.homedir(), ".termos", "sessions");
}

/**
 * Convert a path to a session name by replacing slashes with dashes.
 * Similar to how Claude Code stores projects in ~/.claude/projects/
 * e.g., /Users/foo/myproject -> -Users-foo-myproject
 */
export function pathToSessionName(cwd: string): string {
  // Normalize and convert slashes to dashes
  const normalized = path.resolve(cwd);
  const sessionName = normalized.replace(/[/\\]/g, "-");
  return sessionName || "session";
}

export function getSessionRuntimeDir(sessionName: string): string {
  return path.join(getRuntimeRoot(), sessionName);
}

export function getEventsFilePath(sessionName: string): string {
  return path.join(getSessionRuntimeDir(sessionName), "events.jsonl");
}

export function ensureEventsFile(sessionName: string): string {
  const dir = getSessionRuntimeDir(sessionName);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getEventsFilePath(sessionName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", { flag: "w" });
  }
  return filePath;
}
