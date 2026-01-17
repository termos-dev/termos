import { Box, Text, useInput, useApp } from 'ink';
import { useState, useMemo } from 'react';
import { readFileSync } from 'fs';
import { useTerminalSize, ScrollBar, useMouseScroll, useFileWatch } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  file?: string;
  data?: string;
  title?: string;
  expandDepth?: string;  // Initial expand depth (default: 2)
};

interface JsonNode {
  key: string | number | null;
  value: unknown;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  path: string;
  expanded?: boolean;
  childCount?: number;
}

interface FlatNode {
  node: JsonNode;
  depth: number;
  isLast: boolean;
}

function getType(value: unknown): JsonNode['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as JsonNode['type'];
}

function flattenJson(
  value: unknown,
  key: string | number | null,
  path: string,
  depth: number,
  isLast: boolean,
  expandDepth: number,
  expandedPaths: Set<string>
): FlatNode[] {
  const type = getType(value);
  const isExpandable = type === 'object' || type === 'array';
  const shouldExpand = expandedPaths.has(path) ?? (depth < expandDepth);

  const node: JsonNode = {
    key,
    value,
    type,
    path,
    expanded: isExpandable ? shouldExpand : undefined,
    childCount: isExpandable
      ? (type === 'array' ? (value as unknown[]).length : Object.keys(value as object).length)
      : undefined,
  };

  const result: FlatNode[] = [{ node, depth, isLast }];

  if (isExpandable && shouldExpand) {
    const entries = type === 'array'
      ? (value as unknown[]).map((v, i) => [i, v] as const)
      : Object.entries(value as object);

    entries.forEach(([k, v], idx) => {
      const childPath = `${path}.${k}`;
      const childIsLast = idx === entries.length - 1;
      result.push(...flattenJson(v, k, childPath, depth + 1, childIsLast, expandDepth, expandedPaths));
    });
  }

  return result;
}

function getIndent(depth: number): string {
  return '  '.repeat(depth);
}

function formatValue(value: unknown, type: JsonNode['type']): { text: string; color: string } {
  switch (type) {
    case 'string':
      const str = value as string;
      const truncated = str.length > 50 ? str.slice(0, 47) + '...' : str;
      return { text: `"${truncated}"`, color: 'green' };
    case 'number':
      return { text: String(value), color: 'yellow' };
    case 'boolean':
      return { text: String(value), color: 'magenta' };
    case 'null':
      return { text: 'null', color: 'gray' };
    default:
      return { text: '', color: 'white' };
  }
}

export default function JsonViewer() {
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  const [data, setData] = useState<unknown>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const title = args?.title || 'JSON Viewer';
  const expandDepth = parseInt(args?.expandDepth || '2', 10);
  const visibleRows = Math.max(3, rows - 6);

  useFileWatch(args?.file, () => {
    try {
      let parsed: unknown;

      if (args?.file) {
        const content = readFileSync(args.file, 'utf-8');
        parsed = JSON.parse(content);
      } else if (args?.data) {
        parsed = JSON.parse(args.data);
      } else {
        setError('No data. Use --file <path> or --data <json>');
        return;
      }

      setData(parsed);
      setError(null);

      // Initialize expanded paths based on expandDepth
      const initialExpanded = new Set<string>();
      const initExpand = (val: unknown, path: string, depth: number) => {
        if (depth < expandDepth && val && typeof val === 'object') {
          initialExpanded.add(path);
          if (Array.isArray(val)) {
            val.forEach((v, i) => initExpand(v, `${path}.${i}`, depth + 1));
          } else {
            Object.entries(val).forEach(([k, v]) => initExpand(v, `${path}.${k}`, depth + 1));
          }
        }
      };
      initExpand(parsed, '$', 0);
      setExpandedPaths(initialExpanded);
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const flatNodes = useMemo(() => {
    if (data === null && !error) return [];
    return flattenJson(data, null, '$', 0, true, expandDepth, expandedPaths);
  }, [data, expandedPaths, expandDepth]);

  const maxScroll = Math.max(0, flatNodes.length - visibleRows);
  const showScrollBar = flatNodes.length > visibleRows;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onComplete({ action: 'cancel' });
      exit();
      return;
    }

    if (key.return || input === ' ') {
      const node = flatNodes[selectedIdx]?.node;
      if (node && (node.type === 'object' || node.type === 'array')) {
        toggleExpand(node.path);
      }
      return;
    }

    // Left to collapse
    if (key.leftArrow || input === 'h') {
      const node = flatNodes[selectedIdx]?.node;
      if (node && expandedPaths.has(node.path)) {
        toggleExpand(node.path);
      }
      return;
    }

    // Right to expand
    if (key.rightArrow || input === 'l') {
      const node = flatNodes[selectedIdx]?.node;
      if (node && (node.type === 'object' || node.type === 'array') && !expandedPaths.has(node.path)) {
        toggleExpand(node.path);
      }
      return;
    }

    // Expand all
    if (input === 'e') {
      const allPaths = new Set<string>();
      const collectPaths = (val: unknown, path: string) => {
        if (val && typeof val === 'object') {
          allPaths.add(path);
          if (Array.isArray(val)) {
            val.forEach((v, i) => collectPaths(v, `${path}.${i}`));
          } else {
            Object.entries(val).forEach(([k, v]) => collectPaths(v, `${path}.${k}`));
          }
        }
      };
      collectPaths(data, '$');
      setExpandedPaths(allPaths);
      return;
    }

    // Collapse all
    if (input === 'c') {
      setExpandedPaths(new Set());
      setSelectedIdx(0);
      setScroll(0);
      return;
    }

    if (key.upArrow || input === 'k') {
      const newIdx = Math.max(0, selectedIdx - 1);
      setSelectedIdx(newIdx);
      if (newIdx < scroll) setScroll(newIdx);
    }

    if (key.downArrow || input === 'j') {
      const newIdx = Math.min(flatNodes.length - 1, selectedIdx + 1);
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
      const newIdx = Math.min(flatNodes.length - 1, selectedIdx + visibleRows);
      setSelectedIdx(newIdx);
      setScroll(Math.min(maxScroll, scroll + visibleRows));
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

  if (data === null) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  const displayNodes = flatNodes.slice(scroll, scroll + visibleRows);
  const scrollPosition = maxScroll > 0 ? scroll / maxScroll : 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {displayNodes.map((flatNode, displayIdx) => {
            const actualIdx = scroll + displayIdx;
            const isSelected = actualIdx === selectedIdx;
            const { node, depth } = flatNode;
            const indent = getIndent(depth);

            const isExpandable = node.type === 'object' || node.type === 'array';
            const expandIcon = isExpandable
              ? (node.expanded ? '\u25BC' : '\u25B6')
              : ' ';

            const bracket = node.type === 'array' ? '[]' : node.type === 'object' ? '{}' : '';
            const formatted = !isExpandable ? formatValue(node.value, node.type) : null;

            return (
              <Box key={actualIdx}>
                <Text inverse={isSelected}>
                  <Text dimColor>{indent}</Text>
                  <Text color={isExpandable ? 'cyan' : 'gray'}>{expandIcon} </Text>
                  {node.key !== null && (
                    <>
                      <Text color="blue">"{node.key}"</Text>
                      <Text dimColor>: </Text>
                    </>
                  )}
                  {isExpandable ? (
                    <>
                      <Text dimColor>{bracket}</Text>
                      {node.childCount !== undefined && (
                        <Text dimColor> ({node.childCount} items)</Text>
                      )}
                    </>
                  ) : (
                    <Text color={formatted!.color}>{formatted!.text}</Text>
                  )}
                </Text>
              </Box>
            );
          })}
        </Box>

        {showScrollBar && (
          <ScrollBar position={scrollPosition} height={displayNodes.length} />
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓=navigate  ←→/Space=toggle  e=expand all  c=collapse all  q=close
        </Text>
        {showScrollBar && <Text dimColor>  mouse=scroll</Text>}
      </Box>
    </Box>
  );
}
