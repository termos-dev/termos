import { describe, it, expect } from "vitest";
import {
  getSessionLogDir,
  getServiceLogPath,
  getEventsFilePath,
} from "./tmux-manager.js";

describe("tmux-manager path functions", () => {
  describe("getSessionLogDir", () => {
    it("should return .mide under configDir", () => {
      expect(getSessionLogDir("/path/to/project")).toBe("/path/to/project/.mide");
    });

    it("should handle nested paths", () => {
      expect(getSessionLogDir("/home/user/code/my-app")).toBe("/home/user/code/my-app/.mide");
    });
  });

  describe("getServiceLogPath", () => {
    it("should return log file under .mide", () => {
      expect(getServiceLogPath("/path/to/project", "api")).toBe("/path/to/project/.mide/api.log");
    });

    it("should handle service names with dashes", () => {
      expect(getServiceLogPath("/path/to/project", "my-service")).toBe("/path/to/project/.mide/my-service.log");
    });
  });

  describe("getEventsFilePath", () => {
    it("should return events.jsonl under .mide", () => {
      expect(getEventsFilePath("/path/to/project")).toBe("/path/to/project/.mide/events.jsonl");
    });
  });
});
