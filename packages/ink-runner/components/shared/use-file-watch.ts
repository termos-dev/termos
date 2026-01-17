import { useEffect } from 'react';
import { watchFile, unwatchFile } from 'fs';

const DEFAULT_INTERVAL = 1000;

interface FileWatchOptions {
  deps?: readonly unknown[];
  interval?: number;
}

/**
 * Hook to watch a file for changes and call a callback when it changes.
 * Also calls the callback immediately on mount.
 *
 * @param filePath - Path to watch (if undefined, only calls onLoad once)
 * @param onLoad - Callback to run on mount and when file changes
 * @param options - Optional deps array and interval (default 1000ms)
 */
export function useFileWatch(
  filePath: string | undefined,
  onLoad: () => void,
  options: FileWatchOptions = {}
): void {
  const { deps = [], interval = DEFAULT_INTERVAL } = options;

  useEffect(() => {
    onLoad();

    if (filePath) {
      watchFile(filePath, { interval }, onLoad);
      return () => unwatchFile(filePath);
    }
  }, [filePath, ...deps]);
}

/**
 * Hook to watch multiple files for changes.
 * Calls the callback when any of the files change.
 *
 * @param filePaths - Array of paths to watch (filters out undefined)
 * @param onLoad - Callback to run on mount and when any file changes
 * @param options - Optional deps array and interval (default 1000ms)
 */
export function useMultiFileWatch(
  filePaths: (string | undefined)[],
  onLoad: () => void,
  options: FileWatchOptions = {}
): void {
  const { deps = [], interval = DEFAULT_INTERVAL } = options;

  useEffect(() => {
    onLoad();

    const validPaths = filePaths.filter((p): p is string => !!p);

    for (const path of validPaths) {
      watchFile(path, { interval }, onLoad);
    }

    return () => {
      for (const path of validPaths) {
        unwatchFile(path);
      }
    };
  }, [...filePaths, ...deps]);
}
