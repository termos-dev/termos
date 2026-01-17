import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import { useTerminalSize, ScrollBar, useMouseScroll, useFileWatch } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  file?: string;
  code?: string;
  title?: string;
  editor?: string; // e.g. "code", "vim", "nano"
  'no-header'?: boolean; // Hide header when pane host shows title
};

interface FlowNode {
  id: string;
  label: string;
  shape: 'rect' | 'round' | 'diamond' | 'circle';
}

interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  style: 'solid' | 'dotted';
}

interface ParsedDiagram {
  type: 'flowchart' | 'sequence' | 'unknown';
  direction: 'LR' | 'TD';
  nodes: FlowNode[];
  edges: FlowEdge[];
  raw: string[];
}

function parseMermaid(source: string): ParsedDiagram {
  const lines = source.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const nodeMap = new Map<string, FlowNode>();

  const firstLine = lines[0] || '';
  const firstLineLower = firstLine.toLowerCase();
  let type: ParsedDiagram['type'] = 'unknown';
  let direction: 'LR' | 'TD' = 'TD';

  if (firstLineLower.startsWith('flowchart') || firstLineLower.startsWith('graph')) {
    type = 'flowchart';
    // Extract direction: flowchart LR, flowchart TD, graph LR, etc.
    if (firstLine.includes('LR') || firstLine.includes('RL')) {
      direction = 'LR';
    }
  } else if (firstLineLower.startsWith('sequencediagram')) {
    type = 'sequence';
  }

  // Parse flowchart/graph
  if (type === 'flowchart') {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments and subgraph definitions
      if (line.startsWith('%%') || line.startsWith('subgraph') || line === 'end') continue;

      // Parse edges: A --> B, A -->|text| B, A --- B
      const edgeMatch = line.match(/^(\w+)\s*(-->|---|\.-\.>|==>)\s*(?:\|([^|]*)\|)?\s*(\w+)(?:\[([^\]]+)\])?/);
      if (edgeMatch) {
        const [, fromId, arrow, edgeLabel, toId, toLabel] = edgeMatch;

        // Add nodes if not exist
        if (!nodeMap.has(fromId)) {
          const node: FlowNode = { id: fromId, label: fromId, shape: 'rect' };
          nodeMap.set(fromId, node);
          nodes.push(node);
        }

        let shape: FlowNode['shape'] = 'rect';
        let label = toLabel || toId;

        // Detect shape from label syntax
        if (toLabel) {
          if (toLabel.startsWith('(') && toLabel.endsWith(')')) {
            shape = 'round';
            label = toLabel.slice(1, -1);
          } else if (toLabel.startsWith('{') && toLabel.endsWith('}')) {
            shape = 'diamond';
            label = toLabel.slice(1, -1);
          } else if (toLabel.startsWith('((') && toLabel.endsWith('))')) {
            shape = 'circle';
            label = toLabel.slice(2, -2);
          }
        }

        if (!nodeMap.has(toId)) {
          const node: FlowNode = { id: toId, label, shape };
          nodeMap.set(toId, node);
          nodes.push(node);
        }

        edges.push({
          from: fromId,
          to: toId,
          label: edgeLabel,
          style: arrow === '---' || arrow === '.-.' ? 'dotted' : 'solid',
        });
        continue;
      }

      // Parse standalone node definition: A[Label] or B(Round) or C{Diamond}
      const nodeMatch = line.match(/^(\w+)(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}|\(\(([^)]+)\)\))?$/);
      if (nodeMatch) {
        const [, id, rectLabel, roundLabel, diamondLabel, circleLabel] = nodeMatch;
        if (!nodeMap.has(id)) {
          let shape: FlowNode['shape'] = 'rect';
          let label = id;

          if (rectLabel) { label = rectLabel; shape = 'rect'; }
          else if (roundLabel) { label = roundLabel; shape = 'round'; }
          else if (diamondLabel) { label = diamondLabel; shape = 'diamond'; }
          else if (circleLabel) { label = circleLabel; shape = 'circle'; }

          const node: FlowNode = { id, label, shape };
          nodeMap.set(id, node);
          nodes.push(node);
        }
      }
    }
  }

  return { type, direction, nodes, edges, raw: lines };
}

// Box-drawing characters
const BOX = {
  topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘',
  horizontal: '─', vertical: '│',
  roundTopLeft: '╭', roundTopRight: '╮', roundBottomLeft: '╰', roundBottomRight: '╯',
  arrowRight: '▶', arrowDown: '▼', arrowLeft: '◀', arrowUp: '▲',
  lineH: '─', lineV: '│',
};

interface GridNode {
  node: FlowNode;
  col: number;
  row: number;
  width: number;
  height: number;
}

function renderFlowchartASCII(diagram: ParsedDiagram): string[] {
  const { nodes, edges, direction } = diagram;
  if (nodes.length === 0) return ['(empty flowchart)'];

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  // Calculate width based on longest label (min 16, max 50 for readability)
  const maxLabelLength = Math.max(...nodes.map(n => n.label.length));
  const NODE_WIDTH = Math.min(50, Math.max(16, maxLabelLength + 4));
  const MAX_LABEL_LENGTH = NODE_WIDTH - 4;
  const NODE_HEIGHT = 3;
  const H_SPACING = 4;
  const V_SPACING = 2;

  // Build adjacency list
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  // Assign grid positions using layered layout
  const nodeLevel = new Map<string, number>();
  const visited = new Set<string>();

  // Find roots (no incoming edges)
  const roots = nodes.filter(n => incoming.get(n.id)!.length === 0);
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]);

  // BFS to assign levels
  const queue = roots.map(n => ({ id: n.id, level: 0 }));
  for (const root of roots) visited.add(root.id);

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    nodeLevel.set(id, Math.max(nodeLevel.get(id) || 0, level));

    for (const next of outgoing.get(id) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, level: level + 1 });
      }
    }
  }

  // Handle disconnected nodes
  for (const node of nodes) {
    if (!nodeLevel.has(node.id)) nodeLevel.set(node.id, 0);
  }

  // Group nodes by level
  const levels: FlowNode[][] = [];
  for (const node of nodes) {
    const lvl = nodeLevel.get(node.id) || 0;
    while (levels.length <= lvl) levels.push([]);
    levels[lvl].push(node);
  }

  // Calculate grid positions
  const gridNodes: GridNode[] = [];
  for (let lvl = 0; lvl < levels.length; lvl++) {
    const levelNodes = levels[lvl];
    for (let idx = 0; idx < levelNodes.length; idx++) {
      const node = levelNodes[idx];
      // Truncate only if label exceeds max (for very long labels)
      const label = node.label.length > MAX_LABEL_LENGTH
        ? node.label.slice(0, MAX_LABEL_LENGTH - 1) + '…'
        : node.label;
      const width = Math.max(label.length + 4, 8);

      gridNodes.push({
        node: { ...node, label },
        col: direction === 'LR' ? lvl : idx,
        row: direction === 'LR' ? idx : lvl,
        width,
        height: NODE_HEIGHT,
      });
    }
  }

  // Calculate canvas size
  const maxCol = Math.max(...gridNodes.map(n => n.col));
  const maxRow = Math.max(...gridNodes.map(n => n.row));

  const cellWidth = NODE_WIDTH + H_SPACING;
  const cellHeight = NODE_HEIGHT + V_SPACING;
  const canvasWidth = (maxCol + 1) * cellWidth + 4;
  const canvasHeight = (maxRow + 1) * cellHeight + 2;

  // Create canvas
  const canvas: string[][] = Array(canvasHeight).fill(null).map(() =>
    Array(canvasWidth).fill(' ')
  );

  // Helper to draw on canvas
  const draw = (row: number, col: number, char: string) => {
    if (row >= 0 && row < canvasHeight && col >= 0 && col < canvasWidth) {
      canvas[row][col] = char;
    }
  };

  const drawString = (row: number, col: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      draw(row, col + i, str[i]);
    }
  };

  // Draw nodes
  const nodePositions = new Map<string, { x: number; y: number; w: number }>();

  for (const gn of gridNodes) {
    const x = gn.col * cellWidth + 2;
    const y = gn.row * cellHeight + 1;
    const w = gn.width;

    nodePositions.set(gn.node.id, { x, y, w });

    // Draw box based on shape
    const isRound = gn.node.shape === 'round' || gn.node.shape === 'circle';
    const tl = isRound ? BOX.roundTopLeft : BOX.topLeft;
    const tr = isRound ? BOX.roundTopRight : BOX.topRight;
    const bl = isRound ? BOX.roundBottomLeft : BOX.bottomLeft;
    const br = isRound ? BOX.roundBottomRight : BOX.bottomRight;

    // Top border
    draw(y, x, tl);
    for (let i = 1; i < w - 1; i++) draw(y, x + i, BOX.horizontal);
    draw(y, x + w - 1, tr);

    // Middle with label
    draw(y + 1, x, BOX.vertical);
    const labelPad = Math.floor((w - 2 - gn.node.label.length) / 2);
    drawString(y + 1, x + 1 + labelPad, gn.node.label);
    draw(y + 1, x + w - 1, BOX.vertical);

    // Bottom border
    draw(y + 2, x, bl);
    for (let i = 1; i < w - 1; i++) draw(y + 2, x + i, BOX.horizontal);
    draw(y + 2, x + w - 1, br);
  }

  // Draw edges
  for (const edge of edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);
    if (!fromPos || !toPos) continue;

    const fromLevel = nodeLevel.get(edge.from) || 0;
    const toLevel = nodeLevel.get(edge.to) || 0;

    if (direction === 'LR') {
      // Horizontal flow
      const startX = fromPos.x + fromPos.w;
      const startY = fromPos.y + 1;
      const endX = toPos.x - 1;
      const endY = toPos.y + 1;

      // Draw horizontal line
      for (let x = startX; x < endX; x++) {
        draw(startY, x, BOX.lineH);
      }
      // Draw vertical connector if needed
      if (startY !== endY) {
        const midX = Math.floor((startX + endX) / 2);
        for (let y = Math.min(startY, endY); y <= Math.max(startY, endY); y++) {
          draw(y, midX, BOX.lineV);
        }
      }
      // Arrow
      draw(endY, endX, BOX.arrowRight);
    } else {
      // Vertical flow
      const startX = fromPos.x + Math.floor(fromPos.w / 2);
      const startY = fromPos.y + 3;
      const endX = toPos.x + Math.floor(toPos.w / 2);
      const endY = toPos.y - 1;

      // Draw vertical line
      for (let y = startY; y < endY; y++) {
        draw(y, startX, BOX.lineV);
      }
      // Draw horizontal connector if needed
      if (startX !== endX) {
        const midY = Math.floor((startY + endY) / 2);
        for (let x = Math.min(startX, endX); x <= Math.max(startX, endX); x++) {
          draw(midY, x, BOX.lineH);
        }
        // Vertical segments
        for (let y = startY; y <= midY; y++) draw(y, startX, BOX.lineV);
        for (let y = midY; y < endY; y++) draw(y, endX, BOX.lineV);
      }
      // Arrow
      draw(endY, endX, BOX.arrowDown);
    }
  }

  // Convert canvas to string array
  return canvas.map(row => row.join('').trimEnd()).filter((line, i, arr) => {
    // Remove trailing empty lines
    if (i === arr.length - 1 && !line.trim()) return false;
    return true;
  });
}

export default function MermaidViewer() {
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  const [diagram, setDiagram] = useState<ParsedDiagram | null>(null);
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'ascii' | 'source'>('ascii');

  const title = args?.title || 'Mermaid Diagram';
  const visibleLines = Math.max(5, rows - 6);

  useFileWatch(args?.file, () => {
    try {
      let source = '';

      if (args?.code) {
        source = args.code;
      } else if (args?.file) {
        source = readFileSync(args.file, 'utf-8');
      } else {
        setError('No diagram. Use --file <path> or --code <mermaid>');
        return;
      }

      const parsed = parseMermaid(source);
      setDiagram(parsed);
      setError(null);

      // Default to source view for unknown types
      if (parsed.type === 'unknown') {
        setViewMode('source');
      }
    } catch (e) {
      setError(`Error parsing diagram: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const lines = diagram
    ? viewMode === 'ascii' && diagram.type === 'flowchart'
      ? renderFlowchartASCII(diagram)
      : diagram.raw
    : [];

  const maxScroll = Math.max(0, lines.length - visibleLines);
  const showScrollBar = lines.length > visibleLines;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onComplete({ action: 'accept', type: diagram?.type });
      exit();
      return;
    }

    if (input === 'v') {
      setViewMode(m => m === 'ascii' ? 'source' : 'ascii');
      setScroll(0);
    }

    // Open in editor
    if (input === 'e' && args?.editor && args?.file) {
      const fullCmd = `${args.editor} "${args.file}"`;
      spawn(fullCmd, [], {
        shell: true,
        detached: true,
        stdio: 'ignore',
      }).unref();

      onComplete({ action: 'edit', file: args.file, editor: fullCmd });
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

  return (
    <Box flexDirection="column">
      {!args?.['no-header'] && (
        <Box paddingX={1}>
          <Text bold color="cyan">{title}</Text>
          <Text dimColor> [{diagram?.type || 'unknown'}]</Text>
          <Text dimColor> ({viewMode})</Text>
          {showScrollBar && (
            <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, lines.length)}/{lines.length})</Text>
          )}
        </Box>
      )}

      <Box flexDirection="row">
        <Box flexDirection="column" paddingX={1} marginTop={1} flexGrow={1}>
          {displayLines.map((line, idx) => {
            if (viewMode === 'source') {
              // Syntax highlight source
              let color: string | undefined;
              if (line.startsWith('%%')) color = 'gray';
              else if (line.match(/^(flowchart|graph|sequenceDiagram|classDiagram)/i)) color = 'magenta';
              else if (line.includes('-->') || line.includes('---')) color = 'cyan';
              else if (line.match(/^\w+\[/)) color = 'green';

              return <Text key={idx} color={color}>{line}</Text>;
            } else {
              // ASCII rendering
              let color: string | undefined;
              if (line.startsWith('[') || line.startsWith('(') || line.startsWith('<')) color = 'green';
              else if (line.includes('\u25BC') || line.includes('\u2502') || line.includes('\u250A')) color = 'cyan';

              return <Text key={idx} color={color}>{line}</Text>;
            }
          })}
        </Box>

        {showScrollBar && (
          <ScrollBar position={scrollPosition} height={displayLines.length} />
        )}
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>v=toggle view  ↑↓/jk=scroll  q=close</Text>
        {args?.editor && args?.file && <Text dimColor>  e=edit</Text>}
        {showScrollBar && <Text dimColor>  mouse=scroll</Text>}
      </Box>
    </Box>
  );
}
