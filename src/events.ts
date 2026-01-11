import * as fs from "fs";
import { getEventsFilePath } from "./tmux-manager.js";

/**
 * Event types for the MIDE events file
 */
export type TermosEventType = "ready" | "error" | "result" | "reload" | "status";

export interface TermosEventBase {
  ts: number;
  type: TermosEventType;
}

export interface ReadyEvent extends TermosEventBase {
  type: "ready";
  svc: string;
  port?: number;
  url?: string;
}

export interface ErrorEvent extends TermosEventBase {
  type: "error";
  svc: string;
  msg: string;
  exit?: number;
}

export interface ResultEvent extends TermosEventBase {
  type: "result";
  id: string;
  action: "accept" | "decline" | "cancel" | "timeout";
  answers?: Record<string, string | string[]>;
  result?: unknown;
}

export interface ReloadEvent extends TermosEventBase {
  type: "reload";
  added: string[];
  removed: string[];
  changed: string[];
  dashboardReloaded: boolean;
}

export interface StatusEvent extends TermosEventBase {
  type: "status";
  message: string | null;
  prompts?: string[];
}

export type TermosEvent = ReadyEvent | ErrorEvent | ResultEvent | ReloadEvent | StatusEvent;

/**
 * Append an event to the events file atomically
 */
function appendEvent(configDir: string, event: TermosEvent): void {
  const filePath = getEventsFilePath(configDir);
  const line = JSON.stringify(event) + "\n";
  try {
    fs.appendFileSync(filePath, line, { flag: "a" });
  } catch (err) {
    console.error(`[termos] Failed to write event: ${err}`);
  }
}

/** Write a service ready event */
export function emitReadyEvent(configDir: string, serviceName: string, port?: number, url?: string): void {
  appendEvent(configDir, {
    ts: Date.now(),
    type: "ready",
    svc: serviceName,
    ...(port !== undefined && { port }),
    ...(url !== undefined && { url }),
  });
}

/** Write a service error event */
export function emitErrorEvent(configDir: string, serviceName: string, msg: string, exitCode?: number): void {
  appendEvent(configDir, {
    ts: Date.now(),
    type: "error",
    svc: serviceName,
    msg,
    ...(exitCode !== undefined && { exit: exitCode }),
  });
}

/** Write a config reload event */
export function emitReloadEvent(
  configDir: string,
  added: string[],
  removed: string[],
  changed: string[],
  dashboardReloaded: boolean
): void {
  appendEvent(configDir, {
    ts: Date.now(),
    type: "reload",
    added,
    removed,
    changed,
    dashboardReloaded,
  });
}

/** Write an LLM status event */
export function emitStatusEvent(
  configDir: string,
  message: string | null,
  prompts?: string[]
): void {
  appendEvent(configDir, {
    ts: Date.now(),
    type: "status",
    message,
    ...(prompts && prompts.length > 0 && { prompts }),
  });
}

/** Get the latest status event */
export function getLatestStatus(configDir: string): StatusEvent | null {
  const events = readEvents(configDir);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "status") return event;
  }
  return null;
}

/** Read all events from the events file */
export function readEvents(configDir: string): TermosEvent[] {
  const filePath = getEventsFilePath(configDir);
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8");
    return content.trim().split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line) as TermosEvent; }
      catch { return null; }
    }).filter((e): e is TermosEvent => e !== null);
  } catch {
    return [];
  }
}

/** Find the most recent result event for an interaction ID */
export function findResultEvent(configDir: string, interactionId: string): ResultEvent | null {
  const events = readEvents(configDir);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "result" && event.id === interactionId) return event;
  }
  return null;
}

/** Clear the events file */
export function clearEvents(configDir: string): void {
  try {
    fs.writeFileSync(getEventsFilePath(configDir), "", { flag: "w" });
  } catch {
    // Ignore
  }
}
