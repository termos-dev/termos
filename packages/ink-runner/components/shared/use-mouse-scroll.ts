import { useEffect, useCallback } from 'react';
import { useStdin } from 'ink';

interface UseMouseScrollOptions {
  /** Current scroll position */
  scroll: number;
  /** Maximum scroll value */
  maxScroll: number;
  /** Lines to scroll per wheel tick */
  scrollStep?: number;
  /** Callback to update scroll position */
  setScroll: (value: number | ((prev: number) => number)) => void;
}

/**
 * Hook that enables mouse wheel scrolling in terminal
 * Uses SGR 1006 and legacy mouse modes for broad compatibility
 */
export function useMouseScroll({
  scroll,
  maxScroll,
  scrollStep = 3,
  setScroll,
}: UseMouseScrollOptions): void {
  const { stdin } = useStdin();

  const handleScroll = useCallback((direction: 'up' | 'down') => {
    setScroll(s => {
      if (direction === 'up') return Math.max(0, s - scrollStep);
      return Math.min(maxScroll, s + scrollStep);
    });
  }, [maxScroll, scrollStep, setScroll]);

  useEffect(() => {
    if (!stdin) return;

    // Enable mouse tracking (SGR 1006 mode for better compatibility)
    process.stdout.write('\x1b[?1000h'); // Enable mouse click tracking
    process.stdout.write('\x1b[?1006h'); // Enable SGR extended mode

    const handleData = (data: Buffer) => {
      const str = data.toString();

      // Parse SGR mouse sequences: \x1b[<button;x;y;M or m
      // Button 64 = scroll up, 65 = scroll down
      const sgrMatch = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (sgrMatch) {
        const button = parseInt(sgrMatch[1], 10);
        if (button === 64) handleScroll('up');
        else if (button === 65) handleScroll('down');
        return;
      }

      // Parse legacy mouse sequences: \x1b[M followed by 3 bytes
      if (str.startsWith('\x1b[M') && str.length >= 6) {
        const button = str.charCodeAt(3) - 32;
        if (button === 64) handleScroll('up');
        else if (button === 65) handleScroll('down');
      }
    };

    stdin.on('data', handleData);

    return () => {
      // Disable mouse tracking on cleanup
      process.stdout.write('\x1b[?1006l');
      process.stdout.write('\x1b[?1000l');
      stdin.off('data', handleData);
    };
  }, [stdin, handleScroll]);
}
