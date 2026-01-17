import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';
import { useTerminalSize, ScrollBar, useMouseScroll } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  title?: string;
  items?: string;  // comma-separated
  options?: string;  // alias for items
  checked?: string; // comma-separated indices, e.g. "0,2"
  'no-header'?: boolean; // Hide header when pane host shows title
};

interface Item {
  label: string;
  checked: boolean;
}

export default function Checklist() {
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  const title = args?.title || 'Checklist';
  const rawItems = args?.items || args?.options || '';
  const preChecked = new Set(
    args?.checked?.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) || []
  );

  const parseItems = (input: string): Item[] => {
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((entry) => {
            if (typeof entry === 'string' || typeof entry === 'number') {
              return { label: String(entry), checked: false };
            }
            if (entry && typeof entry === 'object') {
              const obj = entry as Record<string, unknown>;
              const label = typeof obj.label === 'string'
                ? obj.label
                : typeof obj.name === 'string'
                  ? obj.name
                  : typeof obj.title === 'string'
                    ? obj.title
                    : typeof obj.text === 'string'
                      ? obj.text
                      : JSON.stringify(obj);
              const checked = Boolean(obj.checked ?? obj.completed ?? obj.selected);
              return { label, checked };
            }
            return { label: String(entry), checked: false };
          });
        }
      } catch {
        // fall through to comma-separated parsing
      }
    }

    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(label => ({ label, checked: false }));
  };

  const parsedItems = parseItems(rawItems);
  const fallbackItems = parsedItems.length > 0 ? parsedItems : [
    { label: 'Item 1', checked: false },
    { label: 'Item 2', checked: false },
    { label: 'Item 3', checked: false },
  ];
  const initialItems = fallbackItems.map((item, i) =>
    preChecked.has(i) ? { ...item, checked: true } : item
  );
  const itemLabels = initialItems.map(item => item.label);

  const [items, setItems] = useState<Item[]>(initialItems);
  const [cursor, setCursor] = useState(0);
  const [scroll, setScroll] = useState(0);

  const visibleLines = Math.max(5, rows - 8);
  const maxScroll = Math.max(0, items.length - visibleLines);
  const showScrollBar = items.length > visibleLines;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onComplete({ action: 'cancel' });
      exit();
      return;
    }

    // Submit
    if (key.return && cursor === items.length) {
      const checked = items.map((item, i) => item.checked ? i : -1).filter(i => i >= 0);
      onComplete({
        action: 'accept',
        checked,
        items: itemLabels,
        checkedLabels: items.filter(item => item.checked).map(item => item.label),
      });
      exit();
      return;
    }

    // Navigate
    if (key.upArrow || input === 'k') {
      setCursor(c => {
        const newC = Math.max(0, c - 1);
        if (newC < scroll) setScroll(newC);
        return newC;
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor(c => {
        const newC = Math.min(items.length, c + 1); // +1 for Done button
        if (newC >= scroll + visibleLines) setScroll(Math.min(maxScroll, newC - visibleLines + 1));
        return newC;
      });
      return;
    }

    // Toggle item
    if ((input === ' ' || key.return) && cursor < items.length) {
      setItems(prev => prev.map((item, i) =>
        i === cursor ? { ...item, checked: !item.checked } : item
      ));
      return;
    }

    // Check all
    if (input === 'a') {
      setItems(prev => prev.map(item => ({ ...item, checked: true })));
      return;
    }

    // Uncheck all
    if (input === 'n') {
      setItems(prev => prev.map(item => ({ ...item, checked: false })));
      return;
    }
  });

  const displayItems = items.slice(scroll, scroll + visibleLines);
  const checkedCount = items.filter(i => i.checked).length;
  const scrollPosition = maxScroll > 0 ? scroll / maxScroll : 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      {!args?.['no-header'] && (
        <Box marginBottom={1}>
          <Text bold color="cyan">{title}</Text>
          <Text dimColor> ({checkedCount}/{items.length} checked)</Text>
          {showScrollBar && (
            <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, items.length)}/{items.length})</Text>
          )}
        </Box>
      )}

      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {displayItems.map((item, displayIdx) => {
            const actualIdx = scroll + displayIdx;
            const isSelected = actualIdx === cursor;
            const checkbox = item.checked ? '\u2611' : '\u2610';
            const checkColor = item.checked ? 'green' : 'gray';

            return (
              <Box key={actualIdx}>
                <Text inverse={isSelected}>
                  <Text color={checkColor}>{checkbox}</Text>
                  <Text> {item.label}</Text>
                </Text>
              </Box>
            );
          })}

          {/* Done button */}
          <Box marginTop={1}>
            <Text
              inverse={cursor === items.length}
              color={cursor === items.length ? 'green' : undefined}
              bold={cursor === items.length}
            >
              {'  '}[Done]{'  '}
            </Text>
          </Box>
        </Box>

        {showScrollBar && (
          <ScrollBar position={scrollPosition} height={displayItems.length} />
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Space=toggle  a=all  n=none  ↑↓=nav  Enter=done  q=cancel</Text>
        {showScrollBar && <Text dimColor>  mouse=scroll</Text>}
      </Box>
    </Box>
  );
}
