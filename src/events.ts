import * as fs from "fs";
import { getEventsFilePath } from "./runtime.js";

/**
 * Event types for the termos events file
 */
type TermosEventType = "result";

export interface TermosEventBase {
  ts: number;
  type: TermosEventType;
}

export interface ResultEvent extends TermosEventBase {
  type: "result";
  id: string;
  action: "accept" | "decline" | "cancel" | "timeout";
  answers?: Record<string, string | string[]>;
  result?: unknown;
}

export type TermosEvent = ResultEvent;
/** Read all events from the events file */
export function readEvents(sessionName: string): TermosEvent[] {
  const filePath = getEventsFilePath(sessionName);
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
export function findResultEvent(sessionName: string, interactionId: string): ResultEvent | null {
  const events = readEvents(sessionName);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "result" && event.id === interactionId) return event;
  }
  return null;
}

/** Clear the events file */
export function clearEvents(sessionName: string): void {
  try {
    fs.writeFileSync(getEventsFilePath(sessionName), "", { flag: "w" });
  } catch {
    // Ignore
  }
}
