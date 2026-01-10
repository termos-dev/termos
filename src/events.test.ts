import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  appendEvent,
  emitReadyEvent,
  emitErrorEvent,
  emitLogEvent,
  emitResultEvent,
  readEvents,
  findResultEvent,
  clearEvents,
  type MideEvent,
  type ReadyEvent,
  type ErrorEvent,
  type ResultEvent,
} from "./events.js";
import { getEventsFilePath } from "./tmux-manager.js";

describe("events", () => {
  const testSession = "test-events-session";
  const eventsFile = getEventsFilePath(testSession);

  beforeEach(() => {
    // Ensure clean state
    const dir = path.dirname(eventsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    clearEvents(testSession);
  });

  afterEach(() => {
    // Clean up
    try {
      fs.unlinkSync(eventsFile);
      fs.rmdirSync(path.dirname(eventsFile));
    } catch {
      // Ignore
    }
  });

  describe("appendEvent", () => {
    it("should append event as JSONL", () => {
      const event: MideEvent = {
        ts: Date.now(),
        type: "ready",
        svc: "api",
        port: 3000,
      };
      appendEvent(testSession, event);

      const content = fs.readFileSync(eventsFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe("ready");
      expect(parsed.svc).toBe("api");
      expect(parsed.port).toBe(3000);
    });

    it("should append multiple events", () => {
      appendEvent(testSession, { ts: 1, type: "ready", svc: "a" });
      appendEvent(testSession, { ts: 2, type: "ready", svc: "b" });
      appendEvent(testSession, { ts: 3, type: "error", svc: "c", msg: "failed" });

      const events = readEvents(testSession);
      expect(events).toHaveLength(3);
      expect((events[0] as ReadyEvent).svc).toBe("a");
      expect((events[1] as ReadyEvent).svc).toBe("b");
      expect(events[2].type).toBe("error");
    });
  });

  describe("emitReadyEvent", () => {
    it("should emit ready event with port and url", () => {
      emitReadyEvent(testSession, "api", 3000, "http://localhost:3000");

      const events = readEvents(testSession);
      expect(events).toHaveLength(1);

      const event = events[0] as ReadyEvent;
      expect(event.type).toBe("ready");
      expect(event.svc).toBe("api");
      expect(event.port).toBe(3000);
      expect(event.url).toBe("http://localhost:3000");
    });

    it("should emit ready event without optional fields", () => {
      emitReadyEvent(testSession, "worker");

      const events = readEvents(testSession);
      const event = events[0] as ReadyEvent;
      expect(event.svc).toBe("worker");
      expect(event.port).toBeUndefined();
      expect(event.url).toBeUndefined();
    });
  });

  describe("emitErrorEvent", () => {
    it("should emit error event with exit code", () => {
      emitErrorEvent(testSession, "api", "Process crashed", 1);

      const events = readEvents(testSession);
      expect(events).toHaveLength(1);

      const event = events[0] as ErrorEvent;
      expect(event.type).toBe("error");
      expect(event.svc).toBe("api");
      expect(event.msg).toBe("Process crashed");
      expect(event.exit).toBe(1);
    });
  });

  describe("emitResultEvent", () => {
    it("should emit result event with answers", () => {
      const answers = { env: "production", confirm: "yes" };
      emitResultEvent(testSession, "int-1", "accept", answers);

      const events = readEvents(testSession);
      expect(events).toHaveLength(1);

      const event = events[0] as ResultEvent;
      expect(event.type).toBe("result");
      expect(event.id).toBe("int-1");
      expect(event.action).toBe("accept");
      expect(event.answers).toEqual(answers);
    });

    it("should emit cancel result", () => {
      emitResultEvent(testSession, "int-2", "cancel");

      const events = readEvents(testSession);
      const event = events[0] as ResultEvent;
      expect(event.action).toBe("cancel");
      expect(event.answers).toBeUndefined();
    });
  });

  describe("findResultEvent", () => {
    it("should find result event by interaction id", () => {
      emitResultEvent(testSession, "int-1", "accept", { a: "1" });
      emitResultEvent(testSession, "int-2", "decline", { b: "2" });
      emitResultEvent(testSession, "int-3", "cancel");

      const result = findResultEvent(testSession, "int-2");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("int-2");
      expect(result?.action).toBe("decline");
    });

    it("should return most recent result for same id", () => {
      emitResultEvent(testSession, "int-1", "cancel");
      emitResultEvent(testSession, "int-1", "accept", { final: "yes" });

      const result = findResultEvent(testSession, "int-1");
      expect(result?.action).toBe("accept");
      expect(result?.answers).toEqual({ final: "yes" });
    });

    it("should return null for non-existent id", () => {
      emitResultEvent(testSession, "int-1", "accept");

      const result = findResultEvent(testSession, "int-999");
      expect(result).toBeNull();
    });
  });

  describe("clearEvents", () => {
    it("should clear all events", () => {
      emitReadyEvent(testSession, "a");
      emitReadyEvent(testSession, "b");
      expect(readEvents(testSession)).toHaveLength(2);

      clearEvents(testSession);
      expect(readEvents(testSession)).toHaveLength(0);
    });
  });
});
