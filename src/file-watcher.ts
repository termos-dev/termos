import { EventEmitter } from "events";
import * as fs from "fs";

export interface FileWatcherOptions {
  configPath: string;
  debounceMs?: number;
}

export class FileWatcher extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;
  private configPath: string;

  constructor(options: FileWatcherOptions) {
    super();
    this.configPath = options.configPath;
    this.debounceMs = options.debounceMs ?? 300;
  }

  start(): void {
    try {
      this.watcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === "change") {
          this.handleChange();
          return;
        }

        if (eventType === "rename") {
          // Some editors replace the file on save (rename), reattach watcher
          this.handleChange();
          this.restartWatcher();
        }
      });

      this.watcher.on("error", (err) => {
        console.error("[mide] File watcher error:", err.message);
      });
    } catch (err) {
      console.error("[mide] Failed to start file watcher:", err);
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private handleChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.emit("configChanged");
    }, this.debounceMs);
  }

  private restartWatcher(): void {
    // Reattach after a short delay to allow file replacement to complete
    setTimeout(() => {
      if (this.watcher) {
        this.watcher.close();
        this.watcher = null;
      }
      this.start();
    }, 50);
  }
}
