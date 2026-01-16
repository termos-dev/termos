import { useState, useEffect } from 'react';

interface TerminalSize {
  rows: number;
  columns: number;
}

/**
 * Hook that returns terminal dimensions and re-renders on resize
 */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>({
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        rows: process.stdout.rows || 24,
        columns: process.stdout.columns || 80,
      });
    };

    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}
