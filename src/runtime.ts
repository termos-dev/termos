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

export function normalizeSessionName(sessionName: string): string {
  const cleaned = sessionName.replace(/[\\/]/g, "_").replace(/\0/g, "").trim();
  return cleaned.length > 0 ? cleaned : "session";
}

export function getSessionRuntimeDir(sessionName: string): string {
  return path.join(getRuntimeRoot(), normalizeSessionName(sessionName));
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

// Heartbeat file management for session lifecycle
export function getHeartbeatPath(sessionName: string): string {
  return path.join(getSessionRuntimeDir(sessionName), "heartbeat");
}

export function ensureHeartbeat(sessionName: string): void {
  const p = getHeartbeatPath(sessionName);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.closeSync(fs.openSync(p, "w"));
}

export function touchHeartbeat(sessionName: string): void {
  const p = getHeartbeatPath(sessionName);
  const now = new Date();
  fs.utimesSync(p, now, now);
}

function isHeartbeatFresh(sessionName: string, maxAgeMs = 2000): boolean {
  try {
    const stat = fs.statSync(getHeartbeatPath(sessionName));
    return Date.now() - stat.mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}
