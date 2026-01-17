import { Box, Text, useInput, useApp } from 'ink';
import { useState, useEffect } from 'react';
import { readFileSync } from 'fs';
import { useTerminalSize, ScrollBar, useMouseScroll, useFileWatch } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: { file?: string; content?: string; title?: string };

// Simple markdown rendering
function renderLine(line: string, idx: number) {
  if (line.startsWith('### ')) {
    return <Text key={idx} color="yellow">{line.slice(4)}</Text>;
  }
  if (line.startsWith('## ')) {
    return <Text key={idx} bold color="cyan">{line.slice(3)}</Text>;
  }
  if (line.startsWith('# ')) {
    return <Text key={idx} bold color="green">{line.slice(2)}</Text>;
  }
  if (line.startsWith('- [ ] ')) {
    return <Text key={idx}><Text color="gray">☐</Text> {line.slice(6)}</Text>;
  }
  if (line.startsWith('- [x] ')) {
    return <Text key={idx}><Text color="green">☑</Text> {line.slice(6)}</Text>;
  }
  if (line.startsWith('- ')) {
    return <Text key={idx}><Text color="blue">•</Text> {line.slice(2)}</Text>;
  }
  if (line.startsWith('```')) {
    return <Text key={idx} dimColor>{line}</Text>;
  }
  if (!line.trim()) {
    return <Text key={idx}> </Text>;
  }
  return <Text key={idx}>{line}</Text>;
}

export default function MarkdownViewer() {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const [scroll, setScroll] = useState(0);
  const [content, setContent] = useState('');
  const [lines, setLines] = useState<string[]>([]);

  const filePath = args?.file;
  const inlineContent = args?.content;
  const title = args?.title || 'Markdown';

  // Handle inline content (no file watching needed)
  useEffect(() => {
    if (inlineContent) {
      setContent(inlineContent);
      setLines(inlineContent.split('\n'));
    }
  }, [inlineContent]);

  // Handle file content with watching
  useFileWatch(!inlineContent ? filePath : undefined, () => {
    if (inlineContent) return; // Skip if using inline content

    if (!filePath) {
      setContent('No content specified');
      setLines(['No content. Use --file <path> or --content <markdown>']);
      return;
    }

    try {
      const text = readFileSync(filePath, 'utf-8');
      setContent(text);
      setLines(text.split('\n'));
    } catch (e) {
      setContent(`Error: ${filePath}`);
      setLines([`Error reading: ${filePath}`]);
    }
  });

  const visibleLines = Math.max(5, rows - 4);
  const maxScroll = Math.max(0, lines.length - visibleLines);
  const showScrollBar = lines.length > visibleLines;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onComplete({ closed: true, file: filePath });
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
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="cyan">{title}</Text>
        {showScrollBar && (
          <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, lines.length)}/{lines.length})</Text>
        )}
      </Box>

      <Box flexDirection="row">
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          {displayLines.map((line, idx) => renderLine(line, idx))}
        </Box>

        {showScrollBar && (
          <ScrollBar position={scrollPosition} height={displayLines.length} />
        )}
      </Box>

      <Box paddingX={1}>
        <Text dimColor>q=close  ↑↓/jk=scroll  PgUp/PgDn</Text>
        {showScrollBar && <Text dimColor>  mouse=scroll</Text>}
      </Box>
    </Box>
  );
}
