import { describe, it, expect } from "vitest";
import {
  getSessionLogDir,
  getServiceLogPath,
  getEventsFilePath,
} from "./tmux-manager.js";

describe("tmux-manager helpers", () => {
  describe("getSessionLogDir", () => {
    it("should return /tmp/{sessionName}", () => {
      expect(getSessionLogDir("mide-myproject")).toBe("/tmp/mide-myproject");
    });

    it("should handle session names with hyphens", () => {
      expect(getSessionLogDir("mide-my-project-123")).toBe("/tmp/mide-my-project-123");
    });
  });

  describe("getServiceLogPath", () => {
    it("should return log file path for service", () => {
      expect(getServiceLogPath("mide-myproject", "api")).toBe(
        "/tmp/mide-myproject/api.log"
      );
    });

    it("should handle service names with hyphens", () => {
      expect(getServiceLogPath("mide-test", "my-service")).toBe(
        "/tmp/mide-test/my-service.log"
      );
    });
  });

  describe("getEventsFilePath", () => {
    it("should return events.jsonl path", () => {
      expect(getEventsFilePath("mide-myproject")).toBe(
        "/tmp/mide-myproject/events.jsonl"
      );
    });
  });
});
