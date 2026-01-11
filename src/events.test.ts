import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  emitReadyEvent,
  emitErrorEvent,
  readEvents,
  findResultEvent,
  clearEvents,
  type ReadyEvent,
  type ErrorEvent,
  type ResultEvent,
} from "./events.js";
import { getEventsFilePath } from "./tmux-manager.js";

// Helper to emit result events for testing (simulates what ink-runner does)
function emitResultEvent(
  configDir: string,
  id: string,
  action: ResultEvent["action"],
  answers?: Record<string, string | string[]>
): void {
  const filePath = getEventsFilePath(configDir);
  const event = { ts: Date.now(), type: "result", id, action, ...(answers && { answers }) };
  fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
}

describe("events", () => {
  const testDir = path.join(os.tmpdir(), "termos-events-test");
  const eventsFile = getEventsFilePath(testDir);

  beforeEach(() => {
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    clearEvents(testDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe("emitReadyEvent", () => {
    it("should emit ready event with port and url", () => {
      emitReadyEvent(testDir, "api", 3000, "http://localhost:3000");

      const events = readEvents(testDir);
      expect(events).toHaveLength(1);

      const event = events[0] as ReadyEvent;
      expect(event.type).toBe("ready");
      expect(event.svc).toBe("api");
      expect(event.port).toBe(3000);
      expect(event.url).toBe("http://localhost:3000");
    });

    it("should emit ready event without optional fields", () => {
      emitReadyEvent(testDir, "worker");

      const events = readEvents(testDir);
      const event = events[0] as ReadyEvent;
      expect(event.svc).toBe("worker");
      expect(event.port).toBeUndefined();
      expect(event.url).toBeUndefined();
    });

    it("should append multiple events", () => {
      emitReadyEvent(testDir, "a");
      emitReadyEvent(testDir, "b");
      emitErrorEvent(testDir, "c", "failed");

      const events = readEvents(testDir);
      expect(events).toHaveLength(3);
      expect((events[0] as ReadyEvent).svc).toBe("a");
      expect((events[1] as ReadyEvent).svc).toBe("b");
      expect(events[2].type).toBe("error");
    });
  });

  describe("emitErrorEvent", () => {
    it("should emit error event with exit code", () => {
      emitErrorEvent(testDir, "api", "Process crashed", 1);

      const events = readEvents(testDir);
      expect(events).toHaveLength(1);

      const event = events[0] as ErrorEvent;
      expect(event.type).toBe("error");
      expect(event.svc).toBe("api");
      expect(event.msg).toBe("Process crashed");
      expect(event.exit).toBe(1);
    });
  });

  describe("findResultEvent", () => {
    it("should find result event by interaction id", () => {
      emitResultEvent(testDir, "int-1", "accept", { a: "1" });
      emitResultEvent(testDir, "int-2", "decline", { b: "2" });
      emitResultEvent(testDir, "int-3", "cancel");

      const result = findResultEvent(testDir, "int-2");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("int-2");
      expect(result?.action).toBe("decline");
    });

    it("should return most recent result for same id", () => {
      emitResultEvent(testDir, "int-1", "cancel");
      emitResultEvent(testDir, "int-1", "accept", { final: "yes" });

      const result = findResultEvent(testDir, "int-1");
      expect(result?.action).toBe("accept");
      expect(result?.answers).toEqual({ final: "yes" });
    });

    it("should return null for non-existent id", () => {
      emitResultEvent(testDir, "int-1", "accept");

      const result = findResultEvent(testDir, "int-999");
      expect(result).toBeNull();
    });
  });

  describe("clearEvents", () => {
    it("should clear all events", () => {
      emitReadyEvent(testDir, "a");
      emitReadyEvent(testDir, "b");
      expect(readEvents(testDir)).toHaveLength(2);

      clearEvents(testDir);
      expect(readEvents(testDir)).toHaveLength(0);
    });
  });
});
