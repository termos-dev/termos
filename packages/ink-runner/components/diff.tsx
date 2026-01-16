import { Box, Text, useInput, useApp } from 'ink';
import { useState, useEffect } from 'react';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
import { useTerminalSize, ScrollBar, useMouseScroll } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  file?: string;     // single file git diff
  staged?: string;   // "true" for staged changes
  before?: string;   // compare two files
  after?: string;
  title?: string;
};

interface DiffLine {
  type: 'header' | 'add' | 'remove' | 'context' | 'info';
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parseDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('index ') ||
        line.startsWith('---') || line.startsWith('+++')) {
      lines.push({ type: 'header', content: line });
    } else if (line.startsWith('@@')) {
      lines.push({ type: 'info', content: line });
      // Parse line numbers from @@ -start,count +start,count @@
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldNum = parseInt(match[1], 10) - 1;
        newNum = parseInt(match[2], 10) - 1;
      }
    } else if (line.startsWith('+')) {
      newNum++;
      lines.push({ type: 'add', content: line.slice(1), newNum });
    } else if (line.startsWith('-')) {
      oldNum++;
      lines.push({ type: 'remove', content: line.slice(1), oldNum });
    } else {
      oldNum++;
      newNum++;
      lines.push({ type: 'context', content: line.slice(1) || '', oldNum, newNum });
    }
  }

  return lines;
}

function computeSimpleDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  const result: string[] = ['--- a/file', '+++ b/file', '@@ -1 +1 @@'];

  // Simple line-by-line diff (not optimal but works for display)
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    const bLine = beforeLines[i];
    const aLine = afterLines[i];

    if (bLine === undefined) {
      result.push(`+${aLine}`);
    } else if (aLine === undefined) {
      result.push(`-${bLine}`);
    } else if (bLine !== aLine) {
      result.push(`-${bLine}`);
      result.push(`+${aLine}`);
    } else {
      result.push(` ${bLine}`);
    }
  }

  return result.join('\n');
}

function runGitDiff(file: string, staged: boolean): string {
  // Use execFileSync with array args to prevent injection
  const gitArgs = ['diff'];
  if (staged) {
    gitArgs.push('--staged');
  }
  gitArgs.push('--', file);

  try {
    return execFileSync('git', gitArgs, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    // Try with HEAD if simple diff fails
    const headArgs = ['diff'];
    if (staged) {
      headArgs.push('--staged');
    }
    headArgs.push('HEAD', '--', file);
    return execFileSync('git', headArgs, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}

export default function DiffViewer() {
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  const [lines, setLines] = useState<DiffLine[]>([]);
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ additions: 0, deletions: 0 });

  const title = args?.title || (args?.file ? path.basename(args.file) : 'Diff');
  const visibleLines = Math.max(5, rows - 6);

  useEffect(() => {
    try {
      let diffText = '';

      if (args?.before && args?.after) {
        // Compare two files
        const beforeContent = readFileSync(args.before, 'utf-8');
        const afterContent = readFileSync(args.after, 'utf-8');
        diffText = computeSimpleDiff(beforeContent, afterContent);
      } else if (args?.file) {
        // Git diff for single file
        const staged = args?.staged === 'true';
        diffText = runGitDiff(args.file, staged);
      } else {
        setError('No file specified. Use --file <path> or --before/--after');
        return;
      }

      if (!diffText.trim()) {
        setError('No changes detected');
        return;
      }

      const parsed = parseDiff(diffText);
      setLines(parsed);

      // Calculate stats
      const additions = parsed.filter(l => l.type === 'add').length;
      const deletions = parsed.filter(l => l.type === 'remove').length;
      setStats({ additions, deletions });
    } catch (e) {
      setError(`Error getting diff: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const maxScroll = Math.max(0, lines.length - visibleLines);
  const showScrollBar = lines.length > visibleLines;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onComplete({
        action: 'accept',
        file: args?.file,
        additions: stats.additions,
        deletions: stats.deletions,
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
        <Text color="yellow">{error}</Text>
        <Text dimColor>Press q to close</Text>
      </Box>
    );
  }

  const displayLines = lines.slice(scroll, scroll + visibleLines);
  const scrollPosition = maxScroll > 0 ? scroll / maxScroll : 0;

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="cyan">{title}</Text>
        <Text color="green"> +{stats.additions}</Text>
        <Text color="red"> -{stats.deletions}</Text>
        {showScrollBar && (
          <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, lines.length)}/{lines.length})</Text>
        )}
      </Box>

      <Box flexDirection="row">
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          {displayLines.map((line, idx) => {
            let color: string | undefined;
            let prefix = ' ';

            switch (line.type) {
              case 'add':
                color = 'green';
                prefix = '+';
                break;
              case 'remove':
                color = 'red';
                prefix = '-';
                break;
              case 'header':
                color = 'yellow';
                break;
              case 'info':
                color = 'cyan';
                break;
            }

            return (
              <Box key={idx}>
                <Text color={color}>
                  {line.type === 'context' || line.type === 'add' || line.type === 'remove'
                    ? `${prefix} ${line.content}`
                    : line.content
                  }
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
        {showScrollBar && <Text dimColor>  mouse=scroll</Text>}
      </Box>
    </Box>
  );
}
