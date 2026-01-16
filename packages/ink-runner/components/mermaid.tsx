import { Box, Text, useInput, useApp } from 'ink';
import { useState, useEffect } from 'react';
import { readFileSync } from 'fs';
import { useTerminalSize, ScrollBar, useMouseScroll } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  file?: string;
  code?: string;
  title?: string;
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
  nodes: FlowNode[];
  edges: FlowEdge[];
  raw: string[];
}

function parseMermaid(source: string): ParsedDiagram {
  const lines = source.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const nodeMap = new Map<string, FlowNode>();

  const firstLine = lines[0]?.toLowerCase() || '';
  let type: ParsedDiagram['type'] = 'unknown';

  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) {
    type = 'flowchart';
  } else if (firstLine.startsWith('sequencediagram')) {
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

  return { type, nodes, edges, raw: lines };
}

function renderFlowchartASCII(diagram: ParsedDiagram): string[] {
  const output: string[] = [];
  const { nodes, edges } = diagram;

  if (nodes.length === 0) return ['(empty flowchart)'];

  // Simple vertical layout
  const rendered = new Set<string>();

  function drawNode(node: FlowNode): string {
    const label = node.label.length > 20 ? node.label.slice(0, 19) + '…' : node.label;
    const width = Math.max(label.length + 4, 10);
    const pad = ' '.repeat(Math.floor((width - label.length - 2) / 2));

    switch (node.shape) {
      case 'round':
        return `( ${pad}${label}${pad} )`;
      case 'diamond':
        return `< ${pad}${label}${pad} >`;
      case 'circle':
        return `(( ${label} ))`;
      default:
        return `[ ${pad}${label}${pad} ]`;
    }
  }

  // Find root nodes (nodes with no incoming edges)
  const hasIncoming = new Set(edges.map(e => e.to));
  const roots = nodes.filter(n => !hasIncoming.has(n.id));
  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]);
  }

  // BFS traversal to render
  const queue = [...roots];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    const nodeStr = drawNode(node);
    output.push(nodeStr);

    // Find outgoing edges
    const outEdges = edges.filter(e => e.from === node.id);
    for (const edge of outEdges) {
      const arrow = edge.style === 'dotted' ? '┊' : '│';
      output.push(`    ${arrow}`);
      if (edge.label) {
        output.push(`    ${arrow} ${edge.label}`);
      }
      output.push(`    ▼`);

      const target = nodes.find(n => n.id === edge.to);
      if (target && !visited.has(target.id)) {
        queue.push(target);
      }
    }
  }

  return output;
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

  useEffect(() => {
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

      // Default to source view for unknown types
      if (parsed.type === 'unknown') {
        setViewMode('source');
      }
    } catch (e) {
      setError(`Error parsing diagram: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

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
      <Box paddingX={1}>
        <Text bold color="cyan">{title}</Text>
        <Text dimColor> [{diagram?.type || 'unknown'}]</Text>
        <Text dimColor> ({viewMode})</Text>
        {showScrollBar && (
          <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, lines.length)}/{lines.length})</Text>
        )}
      </Box>

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
        {showScrollBar && <Text dimColor>  mouse=scroll</Text>}
      </Box>
    </Box>
  );
}
