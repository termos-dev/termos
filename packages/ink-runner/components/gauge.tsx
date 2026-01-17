import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useState } from 'react';
import { readFileSync } from 'fs';
import { useFileWatch } from './shared/index.js';

/**
 * Calculate ideal height (in rows) based on component args
 */
export function calculateHeight(args: Record<string, string>): number {
  try {
    let gaugeCount = 1;
    if (args.data) {
      const parsed = JSON.parse(args.data);
      gaugeCount = Array.isArray(parsed) ? parsed.length : 1;
    }
    // Each gauge takes ~3 rows + footer (2 lines)
    return Math.min(15, Math.max(5, gaugeCount * 3 + 2));
  } catch {
    return 6; // fallback for single gauge
  }
}

declare const onComplete: (result: unknown) => void;
declare const args: {
  value?: string;         // Current value (0-100 or custom range)
  min?: string;           // Min value (default: 0)
  max?: string;           // Max value (default: 100)
  label?: string;         // Label to display
  title?: string;         // Title above gauge
  unit?: string;          // Unit suffix (e.g., "%", "MB", "°C")
  style?: string;         // bar | arc | blocks | dots
  color?: string;         // Color or "auto" for threshold-based
  thresholds?: string;    // JSON: {"warning": 70, "danger": 90}
  file?: string;          // Watch a file for value updates
  data?: string;          // JSON with multiple gauges
  width?: string;         // Gauge width
};

interface GaugeData {
  value: number;
  min: number;
  max: number;
  label: string;
  unit: string;
  color?: string;
}

interface Thresholds {
  warning?: number;
  danger?: number;
}

const BLOCK_CHARS = ['░', '▒', '▓', '█'];
const BAR_EMPTY = '░';
const BAR_FILLED = '█';
const ARC_CHARS = ['○', '◔', '◑', '◕', '●'];

function getThresholdColor(percent: number, thresholds: Thresholds): string {
  if (thresholds.danger !== undefined && percent >= thresholds.danger) return 'red';
  if (thresholds.warning !== undefined && percent >= thresholds.warning) return 'yellow';
  return 'green';
}

function renderBarGauge(percent: number, width: number, color: string): string {
  const filled = Math.round(percent * width / 100);
  const empty = width - filled;
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(empty);
}

function renderArcGauge(percent: number): string {
  const idx = Math.min(4, Math.floor(percent / 20));
  return ARC_CHARS[idx];
}

function renderBlocksGauge(percent: number, width: number): string {
  const blocks: string[] = [];
  const blockPercent = 100 / width;

  for (let i = 0; i < width; i++) {
    const blockStart = i * blockPercent;
    const blockEnd = (i + 1) * blockPercent;

    if (percent >= blockEnd) {
      blocks.push(BLOCK_CHARS[3]); // Full
    } else if (percent <= blockStart) {
      blocks.push(BLOCK_CHARS[0]); // Empty
    } else {
      // Partial
      const partial = (percent - blockStart) / blockPercent;
      const idx = Math.floor(partial * 4);
      blocks.push(BLOCK_CHARS[Math.min(3, idx)]);
    }
  }

  return blocks.join('');
}

function renderDotsGauge(percent: number, width: number): string {
  const dots = Math.round(percent * width / 100);
  return '●'.repeat(dots) + '○'.repeat(width - dots);
}

function GaugeDisplay({ gauge, style, thresholds, width }: {
  gauge: GaugeData;
  style: string;
  thresholds: Thresholds;
  width: number;
}) {
  const { value, min, max, label, unit, color } = gauge;
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const displayColor = color || (thresholds.warning || thresholds.danger
    ? getThresholdColor(percent, thresholds)
    : 'cyan');

  let gaugeVisual: string;
  switch (style) {
    case 'arc':
      gaugeVisual = renderArcGauge(percent);
      break;
    case 'blocks':
      gaugeVisual = renderBlocksGauge(percent, width);
      break;
    case 'dots':
      gaugeVisual = renderDotsGauge(percent, width);
      break;
    case 'bar':
    default:
      gaugeVisual = renderBarGauge(percent, width, displayColor);
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {label && (
        <Box>
          <Text bold>{label}</Text>
        </Box>
      )}
      <Box>
        {style === 'arc' ? (
          <Box>
            <Text color={displayColor} bold>
              {gaugeVisual}
            </Text>
            <Text> </Text>
            <Text bold>{value.toLocaleString()}</Text>
            <Text dimColor>{unit}</Text>
            <Text dimColor> ({percent.toFixed(0)}%)</Text>
          </Box>
        ) : (
          <>
            <Text color={displayColor}>{gaugeVisual}</Text>
            <Text> </Text>
            <Text bold>{value.toLocaleString()}</Text>
            <Text dimColor>{unit}</Text>
          </>
        )}
      </Box>
      {style !== 'arc' && (
        <Box>
          <Text dimColor>{min}{unit}</Text>
          <Text dimColor>{' '.repeat(Math.max(1, width - String(min).length - String(max).length - 2))}</Text>
          <Text dimColor>{max}{unit}</Text>
        </Box>
      )}
    </Box>
  );
}

export default function Gauge() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [gauges, setGauges] = useState<GaugeData[]>([]);
  const [error, setError] = useState<string | null>(null);

  const title = args?.title || 'Gauge';
  const style = args?.style || 'bar';
  const defaultWidth = parseInt(args?.width || '30', 10);
  const termWidth = stdout?.columns || 80;
  const gaugeWidth = Math.min(defaultWidth, termWidth - 20);

  const thresholds: Thresholds = args?.thresholds
    ? JSON.parse(args.thresholds)
    : {};

  useFileWatch(args?.file, () => {
    try {
      let data: GaugeData[];

      if (args?.data) {
        const parsed = JSON.parse(args.data);
        data = Array.isArray(parsed)
          ? parsed.map(g => ({
              value: Number(g.value ?? 0),
              min: Number(g.min ?? 0),
              max: Number(g.max ?? 100),
              label: String(g.label || ''),
              unit: String(g.unit || '%'),
              color: g.color as string | undefined,
            }))
          : [{
              value: Number(parsed.value ?? 0),
              min: Number(parsed.min ?? 0),
              max: Number(parsed.max ?? 100),
              label: String(parsed.label || ''),
              unit: String(parsed.unit || '%'),
              color: parsed.color as string | undefined,
            }];
      } else if (args?.file) {
        let content: string;
        try {
          content = readFileSync(args.file, 'utf-8');
        } catch (readErr) {
          // File might be temporarily unavailable during write, skip this update
          return;
        }
        const parsed = JSON.parse(content);
        data = Array.isArray(parsed)
          ? parsed.map(g => ({
              value: Number(g.value ?? 0),
              min: Number(g.min ?? 0),
              max: Number(g.max ?? 100),
              label: String(g.label || ''),
              unit: String(g.unit || '%'),
              color: g.color as string | undefined,
            }))
          : [{
              value: Number(parsed.value ?? 0),
              min: Number(parsed.min ?? 0),
              max: Number(parsed.max ?? 100),
              label: String(parsed.label || ''),
              unit: String(parsed.unit || '%'),
              color: parsed.color as string | undefined,
            }];
      } else if (args?.value !== undefined) {
        data = [{
          value: parseFloat(args.value),
          min: parseFloat(args.min || '0'),
          max: parseFloat(args.max || '100'),
          label: args.label || '',
          unit: args.unit || '%',
          color: args.color,
        }];
      } else {
        setError('No data. Use --value <n>, --file <path>, or --data <json>');
        return;
      }

      setGauges(data);
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, { interval: 500 });

  useInput((input, key) => {
    if (key.escape || input === 'q' || key.return) {
      onComplete({
        action: 'accept',
        gauges: gauges.map(g => ({ value: g.value, label: g.label })),
      });
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

  return (
    <Box flexDirection="column" paddingX={1}>
      {gauges.map((gauge, i) => (
        <GaugeDisplay
          key={i}
          gauge={gauge}
          style={style}
          thresholds={thresholds}
          width={gaugeWidth}
        />
      ))}

      <Box marginTop={1}>
        <Text dimColor>Press q or Enter to close</Text>
        {args?.file && <Text dimColor> (watching file for updates)</Text>}
      </Box>
    </Box>
  );
}
