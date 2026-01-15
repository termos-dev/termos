import { Box, Text, useInput, useApp, useStdout, useStdin } from 'ink';
import { useState, useEffect, useCallback } from 'react';
import { readFileSync } from 'fs';
import * as path from 'path';

declare const onComplete: (result: unknown) => void;
declare const args: {
  file?: string;
  title?: string;
  highlight?: string; // "15-20" or "15"
  line?: string; // jump to line
};

// Simple syntax highlighting patterns
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await',
  'try', 'catch', 'throw', 'new', 'this', 'super', 'static', 'get', 'set',
  'interface', 'type', 'enum', 'implements', 'private', 'public', 'protected',
  'readonly', 'abstract', 'declare', 'namespace', 'module', 'require',
  'def', 'elif', 'except', 'finally', 'lambda', 'pass', 'raise', 'with', 'yield',
  'fn', 'pub', 'mod', 'use', 'impl', 'trait', 'struct', 'match', 'mut', 'ref',
]);

function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.rb': 'ruby',
    '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
    '.css': 'css', '.scss': 'scss', '.html': 'html', '.json': 'json',
    '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml', '.sh': 'bash',
  };
  return langMap[ext] || 'text';
}

// Scroll indicator bar component
function ScrollBar({ position, height }: { position: number; height: number }) {
  const trackHeight = Math.max(3, height);
  const thumbSize = Math.max(1, Math.floor(trackHeight * 0.2));
  const thumbPos = Math.floor(position * (trackHeight - thumbSize));

  const chars: string[] = [];
  for (let i = 0; i < trackHeight; i++) {
    if (i >= thumbPos && i < thumbPos + thumbSize) {
      chars.push('█');
    } else {
      chars.push('░');
    }
  }

  return (
    <Box flexDirection="column" marginLeft={1}>
      {chars.map((char, i) => (
        <Text key={i} color="gray">{char}</Text>
      ))}
    </Box>
  );
}

function highlightLine(line: string, lang: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  // Simple tokenization
  const patterns: Array<{ regex: RegExp; color: string }> = [
    { regex: /^(\s*\/\/.*|#.*)/, color: 'gray' }, // comments
    { regex: /^(\s*\/\*[\s\S]*?\*\/)/, color: 'gray' }, // block comments
    { regex: /^("[^"]*"|'[^']*'|`[^`]*`)/, color: 'yellow' }, // strings
    { regex: /^(\d+\.?\d*)/, color: 'magenta' }, // numbers
  ];

  while (remaining.length > 0) {
    let matched = false;

    for (const { regex, color } of patterns) {
      const match = remaining.match(regex);
      if (match) {
        parts.push(<Text key={key++} color={color}>{match[0]}</Text>);
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Check for keywords
      const wordMatch = remaining.match(/^(\w+)/);
      if (wordMatch) {
        const word = wordMatch[0];
        if (KEYWORDS.has(word)) {
          parts.push(<Text key={key++} color="blue" bold>{word}</Text>);
        } else {
          parts.push(<Text key={key++}>{word}</Text>);
        }
        remaining = remaining.slice(word.length);
      } else {
        // Single character
        parts.push(<Text key={key++}>{remaining[0]}</Text>);
        remaining = remaining.slice(1);
      }
    }
  }

  return parts;
}

export default function CodeViewer() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();

  const filePath = args?.file;
  const title = args?.title || (filePath ? path.basename(filePath) : 'Code');
  const highlightRange = args?.highlight;
  const jumpLine = args?.line ? parseInt(args.line, 10) : undefined;

  const [lines, setLines] = useState<string[]>([]);
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [maxScroll, setMaxScroll] = useState(0);

  // Parse highlight range
  const highlightStart = highlightRange
    ? parseInt(highlightRange.split('-')[0], 10)
    : undefined;
  const highlightEnd = highlightRange
    ? parseInt(highlightRange.split('-')[1] || highlightRange.split('-')[0], 10)
    : highlightStart;

  useEffect(() => {
    if (!filePath) {
      setError('No file specified. Use --file <path>');
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      setLines(content.split('\n'));

      // Jump to line if specified
      if (jumpLine && jumpLine > 0) {
        const targetScroll = Math.max(0, jumpLine - Math.floor(visibleLines / 2));
        setScroll(targetScroll);
      } else if (highlightStart) {
        const targetScroll = Math.max(0, highlightStart - 3);
        setScroll(targetScroll);
      }
    } catch (e) {
      setError(`Error reading file: ${filePath}`);
    }
  }, [filePath]);

  const visibleLines = stdout?.rows ? Math.max(5, stdout.rows - 6) : 20;
  const lang = filePath ? getLanguage(filePath) : 'text';
  const lineNumWidth = String(lines.length).length;

  // Update maxScroll when lines or visibleLines change
  useEffect(() => {
    setMaxScroll(Math.max(0, lines.length - visibleLines));
  }, [lines.length, visibleLines]);

  // Mouse scroll support
  const handleScroll = useCallback((direction: 'up' | 'down') => {
    setScroll(s => {
      if (direction === 'up') return Math.max(0, s - 3);
      return Math.min(maxScroll, s + 3);
    });
  }, [maxScroll]);

  useEffect(() => {
    if (!stdin || !setRawMode) return;

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
  }, [stdin, setRawMode, handleScroll]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onComplete({
        action: 'accept',
        file: filePath,
        viewedLines: [scroll + 1, Math.min(scroll + visibleLines, lines.length)],
      });
      exit();
      return;
    }

    if (key.upArrow || input === 'k') {
      setScroll(s => Math.max(0, s - 1));
    }
    if (key.downArrow || input === 'j') {
      setScroll(s => Math.min(maxScroll, s + 1));
    }
    if (key.pageUp) {
      setScroll(s => Math.max(0, s - visibleLines));
    }
    if (key.pageDown) {
      setScroll(s => Math.min(maxScroll, s + visibleLines));
    }

    // Go to top/bottom
    if (input === 'g') {
      setScroll(0);
    }
    if (input === 'G') {
      setScroll(maxScroll);
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">{error}</Text>
        <Text dimColor>Press q to close</Text>
      </Box>
    );
  }

  const displayLines = lines.slice(scroll, scroll + visibleLines);
  const scrollPosition = maxScroll > 0 ? scroll / maxScroll : 0;
  const showScrollBar = lines.length > visibleLines;

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="cyan">{title}</Text>
        <Text dimColor> [{lang}]</Text>
        {showScrollBar && (
          <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, lines.length)}/{lines.length})</Text>
        )}
      </Box>

      <Box flexDirection="row">
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          {displayLines.map((line, displayIdx) => {
            const lineNum = scroll + displayIdx + 1;
            const isHighlighted = highlightStart !== undefined &&
              lineNum >= highlightStart &&
              lineNum <= (highlightEnd || highlightStart);

            return (
              <Box key={displayIdx}>
                <Text color="gray">{String(lineNum).padStart(lineNumWidth, ' ')} │ </Text>
                <Text inverse={isHighlighted} color={isHighlighted ? 'yellow' : undefined}>
                  {highlightLine(line, lang)}
                </Text>
              </Box>
            );
          })}
        </Box>

        {showScrollBar && (
          <ScrollBar position={scrollPosition} height={displayLines.length} />
        )}
      </Box>

      <Box paddingX={1}>
        <Text dimColor>↑↓/jk=scroll  g/G=top/bottom  PgUp/PgDn  q=close</Text>
        {showScrollBar && <Text dimColor>  🖱️=scroll</Text>}
      </Box>
    </Box>
  );
}
