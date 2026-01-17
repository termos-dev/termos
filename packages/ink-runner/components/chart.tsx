import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useState } from 'react';
import { readFileSync } from 'fs';
import { useFileWatch } from './shared/index.js';

/**
 * Calculate ideal height (in rows) based on component args
 */
export function calculateHeight(args: Record<string, string>): number {
  try {
    let dataLength = 5; // default
    if (args.data) {
      const parsed = JSON.parse(args.data);
      dataLength = Array.isArray(parsed) ? parsed.length : 5;
    } else if (args.file) {
      const content = readFileSync(args.file, 'utf-8');
      const parsed = JSON.parse(content);
      dataLength = Array.isArray(parsed) ? parsed.length : 5;
    }
    // data rows + footer (2 lines)
    return Math.min(20, Math.max(6, dataLength + 2));
  } catch {
    return 10; // fallback
  }
}

declare const onComplete: (result: unknown) => void;
declare const args: {
  file?: string;
  data?: string;
  type?: string;       // bar | sparkline | line | stacked
  title?: string;
  height?: string;     // for line graphs
  sort?: string;       // none | asc | desc
  showValues?: string; // true | false
};

type ChartType = 'bar' | 'sparkline' | 'line' | 'stacked';

interface BarDataItem {
  label: string;
  value: number;
  color?: string;
}

interface LineGraphData {
  series: { values: number[]; color?: string }[];
  xLabels?: string[];
}

interface StackedDataItem {
  label: string;
  value: number;
  color?: string;
}

const COLORS = ['cyan', 'green', 'yellow', 'magenta', 'blue', 'red', 'white'];
const BAR_CHARS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const SPARKLINE_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function parseCSV(content: string): BarDataItem[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const labelIdx = headers.findIndex(h => /label|name/i.test(h)) ?? 0;
  const valueIdx = headers.findIndex(h => /value|count|amount/i.test(h)) ?? 1;

  const items: BarDataItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    items.push({
      label: values[labelIdx] || `Item ${i}`,
      value: parseFloat(values[valueIdx]) || 0,
    });
  }
  return items;
}

function parseData(content: string, isCSV: boolean): unknown {
  if (isCSV) return parseCSV(content);
  return JSON.parse(content);
}

function normalizeBarData(data: unknown): BarDataItem[] {
  if (Array.isArray(data)) {
    // Array of numbers -> convert to items
    if (typeof data[0] === 'number') {
      return data.map((v, i) => ({ label: `${i + 1}`, value: v as number }));
    }
    // Array of objects with label/value
    return data.map((item, i) => ({
      label: (item as Record<string, unknown>).label as string ||
             (item as Record<string, unknown>).name as string ||
             `Item ${i + 1}`,
      value: Number((item as Record<string, unknown>).value ??
             (item as Record<string, unknown>).count ??
             (item as Record<string, unknown>).amount ?? 0),
      color: (item as Record<string, unknown>).color as string | undefined,
    }));
  }
  return [];
}

function normalizeSparklineData(data: unknown): number[] {
  if (Array.isArray(data)) {
    if (typeof data[0] === 'number') return data as number[];
    return (data as Record<string, unknown>[]).map(d => Number(d.value ?? 0));
  }
  return [];
}

function normalizeLineData(data: unknown): LineGraphData {
  if (Array.isArray(data)) {
    // Simple array of numbers -> single series
    if (typeof data[0] === 'number') {
      return { series: [{ values: data as number[], color: 'cyan' }] };
    }
    // Array of objects -> extract values
    if ((data[0] as Record<string, unknown>).values) {
      return {
        series: (data as { values: number[]; color?: string }[]).map((s, i) => ({
          values: s.values,
          color: s.color || COLORS[i % COLORS.length],
        })),
      };
    }
    // Array of objects with value field
    return {
      series: [{ values: (data as Record<string, unknown>[]).map(d => Number(d.value ?? 0)), color: 'cyan' }],
    };
  }

  const obj = data as Record<string, unknown>;
  if (obj.series) {
    return {
      series: (obj.series as { values: number[]; color?: string }[]).map((s, i) => ({
        values: s.values,
        color: s.color || COLORS[i % COLORS.length],
      })),
      xLabels: obj.xLabels as string[] | undefined,
    };
  }

  return { series: [] };
}

function BarChart({ data, maxWidth, sort, showValues }: {
  data: BarDataItem[];
  maxWidth: number;
  sort: string;
  showValues: boolean;
}) {
  let items = [...data];

  if (sort === 'asc') items.sort((a, b) => a.value - b.value);
  else if (sort === 'desc') items.sort((a, b) => b.value - a.value);

  const maxValue = Math.max(...items.map(d => d.value), 1);
  const maxLabel = Math.max(...items.map(d => d.label.length), 4);
  const labelWidth = Math.min(maxLabel, 12);
  const valueWidth = showValues ? String(Math.round(maxValue)).length + 2 : 0;
  const barWidth = Math.max(10, maxWidth - labelWidth - valueWidth - 4);

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const ratio = item.value / maxValue;
        const fullBlocks = Math.floor(ratio * barWidth);
        const remainder = (ratio * barWidth) - fullBlocks;
        const partialChar = BAR_CHARS[Math.floor(remainder * 8)] || '';
        const bar = '█'.repeat(fullBlocks) + (remainder > 0.1 ? partialChar : '');
        const color = item.color || COLORS[i % COLORS.length];
        const label = item.label.length > labelWidth
          ? item.label.slice(0, labelWidth - 1) + '…'
          : item.label.padEnd(labelWidth);

        return (
          <Box key={i}>
            <Text dimColor>{label}</Text>
            <Text> </Text>
            <Text color={color}>{bar.padEnd(barWidth)}</Text>
            {showValues && <Text dimColor> {item.value.toLocaleString()}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}

function Sparkline({ data, maxWidth }: { data: number[]; maxWidth: number }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Limit to terminal width
  const displayData = data.length > maxWidth ? data.slice(-maxWidth) : data;

  const chars = displayData.map(v => {
    const normalized = (v - min) / range;
    const idx = Math.min(Math.floor(normalized * 8), 7);
    return SPARKLINE_CHARS[idx];
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">{chars.join('')}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>min: {min.toLocaleString()}</Text>
        <Text dimColor>  max: {max.toLocaleString()}</Text>
        <Text dimColor>  points: {data.length}</Text>
      </Box>
    </Box>
  );
}

function LineGraph({ data, maxWidth, height }: { data: LineGraphData; maxWidth: number; height: number }) {
  const allValues = data.series.flatMap(s => s.values);
  if (allValues.length === 0) {
    return <Text dimColor>No data for line graph</Text>;
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const maxPoints = Math.max(...data.series.map(s => s.values.length));

  // Scale to fit width
  const width = Math.min(maxWidth - 8, maxPoints);
  const yAxisWidth = String(Math.round(max)).length + 1;

  // Build grid (height rows x width cols)
  const grid: string[][] = Array(height).fill(null).map(() => Array(width).fill(' '));
  const gridColors: (string | null)[][] = Array(height).fill(null).map(() => Array(width).fill(null));

  // Plot each series
  for (const series of data.series) {
    const step = series.values.length / width;
    for (let x = 0; x < width; x++) {
      const idx = Math.floor(x * step);
      const value = series.values[idx];
      if (value === undefined) continue;

      const normalized = (value - min) / range;
      const y = Math.min(height - 1, Math.floor((1 - normalized) * height));
      grid[y][x] = '●';
      gridColors[y][x] = series.color || 'cyan';
    }
  }

  // Render
  const yLabels = [max, (max + min) / 2, min].map(v => v.toFixed(0).padStart(yAxisWidth));

  return (
    <Box flexDirection="column">
      {grid.map((row, y) => (
        <Box key={y}>
          {y === 0 && <Text dimColor>{yLabels[0]} │</Text>}
          {y === Math.floor(height / 2) && <Text dimColor>{yLabels[1]} │</Text>}
          {y === height - 1 && <Text dimColor>{yLabels[2]} │</Text>}
          {y !== 0 && y !== Math.floor(height / 2) && y !== height - 1 && (
            <Text dimColor>{' '.repeat(yAxisWidth)} │</Text>
          )}
          {row.map((cell, x) => (
            <Text key={x} color={gridColors[y][x] || undefined}>{cell}</Text>
          ))}
        </Box>
      ))}
      <Box>
        <Text dimColor>{' '.repeat(yAxisWidth)} └{'─'.repeat(width)}</Text>
      </Box>
      {data.xLabels && data.xLabels.length > 0 && (
        <Box marginLeft={yAxisWidth + 2}>
          <Text dimColor>{data.xLabels[0]}</Text>
          <Text dimColor>{' '.repeat(Math.max(1, width - data.xLabels[0].length - (data.xLabels[data.xLabels.length - 1]?.length || 0)))}</Text>
          <Text dimColor>{data.xLabels[data.xLabels.length - 1]}</Text>
        </Box>
      )}
    </Box>
  );
}

function StackedBarChart({ data, maxWidth }: { data: StackedDataItem[]; maxWidth: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const barWidth = Math.min(maxWidth - 4, 60);

  // Build stacked bar
  let bar = '';
  const segments: { char: string; color: string; label: string; pct: number }[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const pct = item.value / total;
    const width = Math.max(1, Math.round(pct * barWidth));
    const color = item.color || COLORS[i % COLORS.length];
    const char = '█'.repeat(width);
    segments.push({ char, color, label: item.label, pct });
    bar += char;
  }

  return (
    <Box flexDirection="column">
      <Box>
        {segments.map((seg, i) => (
          <Text key={i} color={seg.color}>{seg.char}</Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {data.map((item, i) => (
          <Box key={i}>
            <Text color={COLORS[i % COLORS.length]}>■</Text>
            <Text> {item.label}: </Text>
            <Text dimColor>{item.value.toLocaleString()} ({((item.value / total) * 100).toFixed(1)}%)</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function Chart() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const chartType = (args?.type || 'bar') as ChartType;
  const title = args?.title || `${chartType.charAt(0).toUpperCase() + chartType.slice(1)} Chart`;
  const height = parseInt(args?.height || '8', 10);
  const sort = args?.sort || 'none';
  const showValues = args?.showValues !== 'false';
  const termWidth = stdout?.columns || 80;
  const maxWidth = termWidth - 4;

  useFileWatch(args?.file, () => {
    try {
      let rawData: unknown;

      if (args?.data) {
        rawData = JSON.parse(args.data);
      } else if (args?.file) {
        const content = readFileSync(args.file, 'utf-8');
        rawData = parseData(content, args.file.endsWith('.csv'));
      } else {
        setError('No data. Use --file <path> or --data <json>');
        return;
      }

      setData(rawData);
      setError(null);
    } catch (e) {
      setError(`Error parsing data: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  useInput((input, key) => {
    if (input === 'q' || key.escape || key.return) {
      onComplete({ action: 'accept', type: chartType });
      exit();
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

  if (!data) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {chartType === 'bar' && (
        <BarChart
          data={normalizeBarData(data)}
          maxWidth={maxWidth}
          sort={sort}
          showValues={showValues}
        />
      )}

      {chartType === 'sparkline' && (
        <Sparkline data={normalizeSparklineData(data)} maxWidth={maxWidth} />
      )}

      {chartType === 'line' && (
        <LineGraph data={normalizeLineData(data)} maxWidth={maxWidth} height={height} />
      )}

      {chartType === 'stacked' && (
        <StackedBarChart data={normalizeBarData(data)} maxWidth={maxWidth} />
      )}

      <Box marginTop={1}>
        <Text dimColor>Press q or Enter to close</Text>
      </Box>
    </Box>
  );
}
