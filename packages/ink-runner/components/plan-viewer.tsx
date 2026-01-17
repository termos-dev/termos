import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';
import { readFileSync } from 'fs';
import { useTerminalSize, ScrollBar, useMouseScroll, useFileWatch } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: { file?: string };

// Simple markdown-ish rendering
function renderLine(line: string, idx: number) {
  // Headers
  if (line.startsWith('### ')) {
    return <Text key={idx} color="yellow">{line.slice(4)}</Text>;
  }
  if (line.startsWith('## ')) {
    return <Text key={idx} bold color="cyan">{line.slice(3)}</Text>;
  }
  if (line.startsWith('# ')) {
    return <Text key={idx} bold color="green">{line.slice(2)}</Text>;
  }
  // List items
  if (line.startsWith('- [ ] ')) {
    return <Text key={idx}><Text color="gray">[ ]</Text> {line.slice(6)}</Text>;
  }
  if (line.startsWith('- [x] ')) {
    return <Text key={idx}><Text color="green">[x]</Text> {line.slice(6)}</Text>;
  }
  if (line.startsWith('- ')) {
    return <Text key={idx}><Text color="blue">•</Text> {line.slice(2)}</Text>;
  }
  // Code blocks (simple)
  if (line.startsWith('```')) {
    return <Text key={idx} dimColor>{line}</Text>;
  }
  // Bold
  if (line.includes('**')) {
    return <Text key={idx}>{line}</Text>;
  }
  // Empty line
  if (!line.trim()) {
    return <Text key={idx}> </Text>;
  }
  return <Text key={idx}>{line}</Text>;
}

export default function PlanViewer() {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const [scroll, setScroll] = useState(0);
  const [lines, setLines] = useState<string[]>([]);

  const filePath = args?.file;

  useFileWatch(filePath, () => {
    if (!filePath) {
      setLines(['No plan file specified']);
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      setLines(content.split('\n'));
    } catch (e) {
      setLines([`Error reading file: ${filePath}`]);
    }
  });

  const visibleLines = Math.max(5, rows - 6);
  const maxScroll = Math.max(0, lines.length - visibleLines);
  const showScrollBar = lines.length > visibleLines;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onComplete({ approved: true, file: filePath });
      exit();
    }
    if (input === 'n' || input === 'N' || key.escape) {
      onComplete({ approved: false, file: filePath });
      exit();
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
  });

  const displayLines = lines.slice(scroll, scroll + visibleLines);
  const scrollPosition = maxScroll > 0 ? scroll / maxScroll : 0;

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Plan Review</Text>
        {showScrollBar && (
          <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, lines.length)}/{lines.length})</Text>
        )}
      </Box>

      <Box flexDirection="row" marginY={1}>
        <Box flexDirection="column" flexGrow={1}>
          {displayLines.map((line, idx) => renderLine(line, idx))}
        </Box>

        {showScrollBar && (
          <ScrollBar position={scrollPosition} height={displayLines.length} />
        )}
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text>
          <Text color="green" bold>Y</Text><Text dimColor>=approve</Text>
          <Text> </Text>
          <Text color="red" bold>N</Text><Text dimColor>=reject</Text>
          <Text> </Text>
          <Text dimColor>↑↓/jk=scroll</Text>
          {showScrollBar && <Text dimColor>  mouse=scroll</Text>}
        </Text>
      </Box>
    </Box>
  );
}
