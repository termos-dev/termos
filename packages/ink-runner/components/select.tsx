import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useState, useEffect, useMemo } from 'react';
import { readFileSync } from 'fs';

/**
 * Calculate ideal height (in rows) based on component args
 */
export function calculateHeight(args: Record<string, string>): number {
  try {
    let itemCount = 5;
    const items = args.items || args.options;
    if (items) {
      try {
        const parsed = JSON.parse(items);
        itemCount = Array.isArray(parsed) ? parsed.length : 5;
      } catch {
        itemCount = items.split(',').length;
      }
    } else if (args.file) {
      const content = readFileSync(args.file, 'utf-8');
      const parsed = JSON.parse(content);
      itemCount = Array.isArray(parsed) ? parsed.length : 5;
    }
    // items + search bar (if enabled) + footer
    const searchRows = args.search === 'true' ? 2 : 0;
    return Math.min(20, Math.max(6, itemCount + searchRows + 2));
  } catch {
    return 10; // fallback
  }
}

declare const onComplete: (result: unknown) => void;
declare const args: {
  items?: string;       // comma-separated or JSON array
  options?: string;     // alias for items
  file?: string;        // JSON file with items
  title?: string;
  placeholder?: string;
  search?: string;      // "true" to enable fuzzy search
};

interface SelectItem {
  label: string;
  value: string;
  description?: string;
}

function normalizeItems(data: unknown): SelectItem[] {
  if (typeof data === 'string') {
    // Comma-separated string
    return data.split(',').map(s => {
      const trimmed = s.trim();
      return { label: trimmed, value: trimmed };
    });
  }

  if (Array.isArray(data)) {
    return data.map((item, i) => {
      if (typeof item === 'string') {
        return { label: item, value: item };
      }
      const obj = item as Record<string, unknown>;
      return {
        label: String(obj.label || obj.name || obj.title || `Item ${i + 1}`),
        value: String(obj.value ?? obj.id ?? obj.label ?? obj.name ?? i),
        description: obj.description as string | undefined,
      };
    });
  }

  return [];
}

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let queryIdx = 0;
  for (let i = 0; i < lowerText.length && queryIdx < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIdx]) {
      queryIdx++;
    }
  }
  return queryIdx === lowerQuery.length;
}

export default function Select() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [items, setItems] = useState<SelectItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const searchEnabled = args?.search === 'true';
  const title = args?.title || 'Select';
  const placeholder = args?.placeholder || 'Type to search...';
  const visibleRows = stdout?.rows ? Math.max(3, stdout.rows - 8) : 10;

  useEffect(() => {
    try {
      let data: unknown;

      if (args?.file) {
        const content = readFileSync(args.file, 'utf-8');
        data = JSON.parse(content);
      } else if (args?.items || args?.options) {
        const raw = args.items || args.options || '';
        // Try JSON parse first
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw; // Use as comma-separated string
        }
      } else {
        setError('No items. Use --items "a,b,c" or --file <path>');
        return;
      }

      const normalized = normalizeItems(data);
      if (normalized.length === 0) {
        setError('No items to display');
        return;
      }

      setItems(normalized);
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    return items.filter(item =>
      fuzzyMatch(item.label, searchQuery) ||
      (item.description && fuzzyMatch(item.description, searchQuery))
    );
  }, [items, searchQuery]);

  const maxScroll = Math.max(0, filteredItems.length - visibleRows);

  useInput((input, key) => {
    if (key.escape) {
      onComplete({ action: 'cancel', selected: null });
      exit();
      return;
    }

    if (key.return) {
      const selected = filteredItems[selectedIdx];
      onComplete({
        action: 'accept',
        selected: selected?.value ?? null,
        selectedLabel: selected?.label ?? null,
        selectedIndex: selectedIdx,
      });
      exit();
      return;
    }

    // Search input
    if (searchEnabled && input && !key.upArrow && !key.downArrow && !key.return) {
      if (key.backspace || key.delete) {
        setSearchQuery(q => q.slice(0, -1));
        setSelectedIdx(0);
        setScroll(0);
      } else if (input.length === 1 && input.charCodeAt(0) >= 32) {
        setSearchQuery(q => q + input);
        setSelectedIdx(0);
        setScroll(0);
      }
      return;
    }

    if (key.upArrow || input === 'k') {
      const newIdx = Math.max(0, selectedIdx - 1);
      setSelectedIdx(newIdx);
      if (newIdx < scroll) setScroll(newIdx);
    }

    if (key.downArrow || input === 'j') {
      const newIdx = Math.min(filteredItems.length - 1, selectedIdx + 1);
      setSelectedIdx(newIdx);
      if (newIdx >= scroll + visibleRows) {
        setScroll(Math.min(maxScroll, newIdx - visibleRows + 1));
      }
    }

    if (key.pageUp) {
      const newIdx = Math.max(0, selectedIdx - visibleRows);
      setSelectedIdx(newIdx);
      setScroll(Math.max(0, scroll - visibleRows));
    }

    if (key.pageDown) {
      const newIdx = Math.min(filteredItems.length - 1, selectedIdx + visibleRows);
      setSelectedIdx(newIdx);
      setScroll(Math.min(maxScroll, scroll + visibleRows));
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">{error}</Text>
        <Text dimColor>Press Esc to close</Text>
      </Box>
    );
  }

  const displayItems = filteredItems.slice(scroll, scroll + visibleRows);

  return (
    <Box flexDirection="column" paddingX={1}>
      {searchEnabled && (
        <Box marginBottom={1}>
          <Text dimColor>🔍 </Text>
          <Text>{searchQuery || <Text dimColor>{placeholder}</Text>}</Text>
          <Text dimColor>▎</Text>
        </Box>
      )}

      <Box flexDirection="column">
        {displayItems.map((item, displayIdx) => {
          const actualIdx = scroll + displayIdx;
          const isSelected = actualIdx === selectedIdx;

          return (
            <Box key={actualIdx}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? '❯ ' : '  '}
              </Text>
              <Text bold={isSelected} inverse={isSelected}>
                {item.label}
              </Text>
              {item.description && (
                <Text dimColor> - {item.description}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {filteredItems.length === 0 && searchQuery && (
        <Text dimColor>No matches for "{searchQuery}"</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓=navigate  Enter=select  Esc=cancel
          {searchEnabled ? '  Type to filter' : ''}
        </Text>
      </Box>
    </Box>
  );
}
