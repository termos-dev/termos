import { Box, Text, useInput, useApp } from 'ink';
import { useState, useMemo } from 'react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { useTerminalSize, ScrollBar, useMouseScroll, useFileWatch } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  path?: string;        // Directory path to show
  dir?: string;         // alias for path
  file?: string;        // JSON file with tree structure
  data?: string;        // JSON tree data inline
  depth?: string;       // Max depth to show
  showHidden?: string;  // "true" to show hidden files
  title?: string;
};

interface TreeNode {
  name: string;
  path?: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
  expanded?: boolean;
}

interface FlatNode {
  node: TreeNode;
  depth: number;
  isLast: boolean[];
}

function readDirectory(dirPath: string, maxDepth: number, showHidden: boolean, currentDepth = 0): TreeNode {
  const name = basename(dirPath) || dirPath;
  const node: TreeNode = {
    name,
    path: dirPath,
    type: 'directory',
    children: [],
    expanded: currentDepth < 2, // Auto-expand first 2 levels
  };

  if (currentDepth >= maxDepth) {
    return node;
  }

  try {
    const entries = readdirSync(dirPath);
    const filtered = showHidden ? entries : entries.filter(e => !e.startsWith('.'));
    const sorted = filtered.sort((a, b) => {
      const aIsDir = statSync(join(dirPath, a)).isDirectory();
      const bIsDir = statSync(join(dirPath, b)).isDirectory();
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

    for (const entry of sorted) {
      const fullPath = join(dirPath, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          node.children!.push(readDirectory(fullPath, maxDepth, showHidden, currentDepth + 1));
        } else {
          node.children!.push({
            name: entry,
            path: fullPath,
            type: 'file',
          });
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {
    // Can't read directory
  }

  return node;
}

function parseTreeData(data: unknown): TreeNode {
  if (typeof data !== 'object' || data === null) {
    return { name: 'root', type: 'directory', children: [] };
  }

  const obj = data as Record<string, unknown>;
  return {
    name: String(obj.name || obj.label || 'root'),
    path: obj.path as string | undefined,
    type: (obj.type as 'file' | 'directory') || (obj.children ? 'directory' : 'file'),
    children: Array.isArray(obj.children)
      ? obj.children.map(c => parseTreeData(c))
      : undefined,
    expanded: obj.expanded as boolean | undefined ?? true,
  };
}

function flattenTree(node: TreeNode, depth: number, isLast: boolean[]): FlatNode[] {
  const result: FlatNode[] = [{ node, depth, isLast: [...isLast] }];

  if (node.expanded && node.children) {
    node.children.forEach((child, idx) => {
      const childIsLast = idx === node.children!.length - 1;
      result.push(...flattenTree(child, depth + 1, [...isLast, childIsLast]));
    });
  }

  return result;
}

function getTreePrefix(isLast: boolean[]): string {
  if (isLast.length === 0) return '';

  let prefix = '';
  for (let i = 0; i < isLast.length - 1; i++) {
    prefix += isLast[i] ? '    ' : '│   ';
  }
  prefix += isLast[isLast.length - 1] ? '└── ' : '├── ';
  return prefix;
}

export default function Tree() {
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  const [root, setRoot] = useState<TreeNode | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const title = args?.title || 'Tree';
  const maxDepth = parseInt(args?.depth || '5', 10);
  const showHidden = args?.showHidden === 'true';
  const visibleRows = Math.max(3, rows - 6);

  useFileWatch(args?.file, () => {
    try {
      let tree: TreeNode;

      const dirPath = args?.path || args?.dir;
      if (dirPath) {
        tree = readDirectory(dirPath, maxDepth, showHidden);
      } else if (args?.file) {
        const content = readFileSync(args.file, 'utf-8');
        tree = parseTreeData(JSON.parse(content));
      } else if (args?.data) {
        tree = parseTreeData(JSON.parse(args.data));
      } else {
        // Default to current directory
        tree = readDirectory(process.cwd(), maxDepth, showHidden);
      }

      setRoot(tree);
      setError(null);
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const flatNodes = useMemo(() => {
    if (!root) return [];
    return flattenTree(root, 0, []);
  }, [root]);

  const maxScroll = Math.max(0, flatNodes.length - visibleRows);
  const showScrollBar = flatNodes.length > visibleRows;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  const toggleExpand = (idx: number) => {
    const flatNode = flatNodes[idx];
    if (flatNode.node.type === 'directory' && flatNode.node.children) {
      flatNode.node.expanded = !flatNode.node.expanded;
      // Force re-render
      setRoot(r => r ? { ...r } : null);
    }
  };

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      const selected = flatNodes[selectedIdx]?.node;
      onComplete({
        action: 'cancel',
        selected: selected?.path ?? selected?.name ?? null,
      });
      exit();
      return;
    }

    if (key.return) {
      const selected = flatNodes[selectedIdx]?.node;
      if (selected?.type === 'directory') {
        toggleExpand(selectedIdx);
      } else {
        onComplete({
          action: 'accept',
          selected: selected?.path ?? selected?.name ?? null,
          type: selected?.type,
        });
        exit();
      }
      return;
    }

    // Space to toggle expand
    if (input === ' ') {
      toggleExpand(selectedIdx);
      return;
    }

    // Left arrow to collapse
    if (key.leftArrow || input === 'h') {
      const node = flatNodes[selectedIdx]?.node;
      if (node?.type === 'directory' && node.expanded) {
        node.expanded = false;
        setRoot(r => r ? { ...r } : null);
      }
      return;
    }

    // Right arrow to expand
    if (key.rightArrow || input === 'l') {
      const node = flatNodes[selectedIdx]?.node;
      if (node?.type === 'directory' && !node.expanded && node.children?.length) {
        node.expanded = true;
        setRoot(r => r ? { ...r } : null);
      }
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

  if (!root) {
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
            const { node, isLast } = flatNode;
            const prefix = getTreePrefix(isLast);

            const icon = node.type === 'directory'
              ? (node.expanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1')
              : '\uD83D\uDCC4';

            return (
              <Box key={actualIdx}>
                <Text dimColor>{prefix}</Text>
                <Text inverse={isSelected}>
                  {icon} <Text bold={isSelected} color={node.type === 'directory' ? 'cyan' : undefined}>
                    {node.name}
                  </Text>
                  {node.type === 'directory' && node.children && (
                    <Text dimColor> ({node.children.length})</Text>
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
          ↑↓=navigate  ←→/Space=expand/collapse  Enter=select  q=close
          {showScrollBar ? '  mouse=scroll' : ''}
        </Text>
      </Box>
    </Box>
  );
}
