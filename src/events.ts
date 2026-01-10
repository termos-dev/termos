import * as fs from "fs";
import { getEventsFilePath } from "./tmux-manager.js";

/**
 * Event types for the MIDE events file
 */
export type MideEventType = "ready" | "error" | "log" | "result" | "reload";

export interface MideEventBase {
  ts: number;
  type: MideEventType;
}

export interface ReadyEvent extends MideEventBase {
  type: "ready";
  svc: string;
  port?: number;
  url?: string;
}

export interface ErrorEvent extends MideEventBase {
  type: "error";
  svc: string;
  msg: string;
  exit?: number;
}

export interface LogEvent extends MideEventBase {
  type: "log";
  svc: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface ResultEvent extends MideEventBase {
  type: "result";
  id: string;
  action: "accept" | "decline" | "cancel" | "timeout";
  answers?: Record<string, string | string[]>;
  result?: unknown;
}

export interface ReloadEvent extends MideEventBase {
  type: "reload";
  added: string[];
  removed: string[];
  changed: string[];
  dashboardReloaded: boolean;
}

export type MideEvent = ReadyEvent | ErrorEvent | LogEvent | ResultEvent | ReloadEvent;

/**
 * Append an event to the events file atomically
 * Uses O_APPEND flag to ensure atomic writes even with concurrent writers
 */
export function appendEvent(sessionName: string, event: MideEvent): void {
  const filePath = getEventsFilePath(sessionName);
  const line = JSON.stringify(event) + "\n";

  try {
    // Use appendFileSync with flag to ensure atomic append
    fs.appendFileSync(filePath, line, { flag: "a" });
  } catch (err) {
    console.error(`[mide] Failed to write event: ${err}`);
  }
}

/**
 * Write a service ready event
 */
export function emitReadyEvent(sessionName: string, serviceName: string, port?: number, url?: string): void {
  const event: ReadyEvent = {
    ts: Date.now(),
    type: "ready",
    svc: serviceName,
    ...(port !== undefined && { port }),
    ...(url !== undefined && { url }),
  };
  appendEvent(sessionName, event);
}

/**
 * Write a service error event
 */
export function emitErrorEvent(sessionName: string, serviceName: string, msg: string, exitCode?: number): void {
  const event: ErrorEvent = {
    ts: Date.now(),
    type: "error",
    svc: serviceName,
    msg,
    ...(exitCode !== undefined && { exit: exitCode }),
  };
  appendEvent(sessionName, event);
}

/**
 * Write a log event
 */
export function emitLogEvent(sessionName: string, serviceName: string, level: "info" | "warn" | "error", msg: string): void {
  const event: LogEvent = {
    ts: Date.now(),
    type: "log",
    svc: serviceName,
    level,
    msg,
  };
  appendEvent(sessionName, event);
}

/**
 * Write an interaction result event
 */
export function emitResultEvent(
  sessionName: string,
  interactionId: string,
  action: "accept" | "decline" | "cancel" | "timeout",
  answers?: Record<string, string | string[]>,
  result?: unknown
): void {
  const event: ResultEvent = {
    ts: Date.now(),
    type: "result",
    id: interactionId,
    action,
    ...(answers !== undefined && { answers }),
    ...(result !== undefined && { result }),
  };
  appendEvent(sessionName, event);
}

/**
 * Write a config reload event
 */
export function emitReloadEvent(
  sessionName: string,
  added: string[],
  removed: string[],
  changed: string[],
  dashboardReloaded: boolean
): void {
  const event: ReloadEvent = {
    ts: Date.now(),
    type: "reload",
    added,
    removed,
    changed,
    dashboardReloaded,
  };
  appendEvent(sessionName, event);
}

/**
 * Read all events from the events file
 * Returns events in chronological order
 */
export function readEvents(sessionName: string): MideEvent[] {
  const filePath = getEventsFilePath(sessionName);

  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    return lines.map(line => {
      try {
        return JSON.parse(line) as MideEvent;
      } catch {
        return null;
      }
    }).filter((e): e is MideEvent => e !== null);
  } catch {
    return [];
  }
}

/**
 * Find the most recent result event for an interaction ID
 */
export function findResultEvent(sessionName: string, interactionId: string): ResultEvent | null {
  const events = readEvents(sessionName);

  // Search from end (most recent first)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "result" && event.id === interactionId) {
      return event;
    }
  }

  return null;
}

/**
 * Clear the events file (used on session start)
 */
export function clearEvents(sessionName: string): void {
  const filePath = getEventsFilePath(sessionName);
  try {
    fs.writeFileSync(filePath, "", { flag: "w" });
  } catch {
    // Ignore errors
  }
}
