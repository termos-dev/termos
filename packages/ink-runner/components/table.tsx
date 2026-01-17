import { Box, Text, useInput, useApp } from 'ink';
import { useState, useRef } from 'react';
import { readFileSync } from 'fs';
import { useTerminalSize, ScrollBar, useMouseScroll, useFileWatch } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  file?: string;
  data?: string;      // JSON string
  rows?: string;      // alias for data
  content?: string;   // alias for data
  columns?: string;   // comma-separated column names
  title?: string;
  select?: string;    // "true" to enable row selection
  'no-header'?: boolean; // Hide header when pane host shows title
};

type Row = Record<string, unknown>;

function parseCSV(content: string): Row[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function parseJSON(content: string): Row[] {
  const data = JSON.parse(content);
  if (Array.isArray(data)) return data;
  if (typeof data === 'object' && data !== null) {
    // Support {headers, rows} format - transform to array-of-objects
    if (Array.isArray(data.headers) && Array.isArray(data.rows)) {
      const headers = data.headers as string[];
      return (data.rows as unknown[][]).map(row => {
        const obj: Row = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] ?? '';
        });
        return obj;
      });
    }
    return [data];
  }
  return [];
}

function getColumnWidths(rows: Row[], columns: string[], maxWidth: number): number[] {
  return columns.map(col => {
    const headerLen = col.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = String(row[col] ?? '');
      return Math.max(max, val.length);
    }, 0);
    return Math.min(Math.max(headerLen, maxDataLen, 3), maxWidth);
  });
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str.padEnd(len);
  return str.slice(0, len - 1) + '…';
}

export default function TableViewer() {
  const { exit } = useApp();
  const { rows: termRows, columns: termCols } = useTerminalSize();

  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [scroll, setScroll] = useState(0);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = args?.title || 'Table';
  const selectMode = args?.select === 'true';
  const visibleRows = Math.max(3, termRows - 8);
  const termWidth = termCols;

  const isFirstLoad = useRef(true);

  useFileWatch(args?.file, () => {
    try {
      let data: Row[] = [];

      const dataArg = args?.data || args?.rows || args?.content;
      if (dataArg) {
        data = parseJSON(dataArg);
      } else if (args?.file) {
        const content = readFileSync(args.file, 'utf-8');
        if (args.file.endsWith('.csv')) {
          data = parseCSV(content);
        } else {
          data = parseJSON(content);
        }
      } else {
        setError('No data. Use --file <path> or --data <json>');
        return;
      }

      if (data.length === 0) {
        setError('No data to display');
        return;
      }

      setRows(data);
      setError(null);

      // Determine columns
      let cols: string[];
      if (args?.columns) {
        cols = args.columns.split(',').map(c => c.trim());
      } else {
        // Auto-detect from first row
        cols = Object.keys(data[0]);
      }
      setColumns(cols);

      // Only set initial selection on first load
      if (isFirstLoad.current && selectMode) {
        isFirstLoad.current = false;
        setSelectedRow(0);
      }
    } catch (e) {
      setError(`Error parsing data: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const maxScroll = Math.max(0, rows.length - visibleRows);
  const maxColWidth = Math.floor((termWidth - columns.length * 3 - 4) / columns.length);
  const colWidths = columns.length > 0 ? getColumnWidths(rows, columns, maxColWidth) : [];
  const showScrollBar = rows.length > visibleRows;

  // Mouse scroll support
  useMouseScroll({ scroll, maxScroll, setScroll });

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onComplete({
        action: 'accept',
        rows: rows.length,
        selectedRow: selectedRow !== null ? rows[selectedRow] : null,
        selectedIndex: selectedRow,
      });
      exit();
      return;
    }

    if (key.return && selectMode && selectedRow !== null) {
      onComplete({
        action: 'accept',
        rows: rows.length,
        selectedRow: rows[selectedRow],
        selectedIndex: selectedRow,
      });
      exit();
      return;
    }

    if (key.upArrow || input === 'k') {
      if (selectMode && selectedRow !== null) {
        const newSel = Math.max(0, selectedRow - 1);
        setSelectedRow(newSel);
        if (newSel < scroll) setScroll(newSel);
      } else {
        setScroll(s => Math.max(0, s - 1));
      }
    }

    if (key.downArrow || input === 'j') {
      if (selectMode && selectedRow !== null) {
        const newSel = Math.min(rows.length - 1, selectedRow + 1);
        setSelectedRow(newSel);
        if (newSel >= scroll + visibleRows) setScroll(Math.min(maxScroll, newSel - visibleRows + 1));
      } else {
        setScroll(s => Math.min(maxScroll, s + 1));
      }
    }

    if (key.pageUp) {
      setScroll(s => Math.max(0, s - visibleRows));
      if (selectMode && selectedRow !== null) {
        setSelectedRow(s => Math.max(0, (s ?? 0) - visibleRows));
      }
    }

    if (key.pageDown) {
      setScroll(s => Math.min(maxScroll, s + visibleRows));
      if (selectMode && selectedRow !== null) {
        setSelectedRow(s => Math.min(rows.length - 1, (s ?? 0) + visibleRows));
      }
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow">{error}</Text>
        <Text dimColor>Press q to close</Text>
      </Box>
    );
  }

  const displayRows = rows.slice(scroll, scroll + visibleRows);
  const scrollPosition = maxScroll > 0 ? scroll / maxScroll : 0;

  // Build table borders
  const topBorder = '\u250C' + colWidths.map(w => '\u2500'.repeat(w + 2)).join('\u252C') + '\u2510';
  const headerSep = '\u251C' + colWidths.map(w => '\u2500'.repeat(w + 2)).join('\u253C') + '\u2524';
  const bottomBorder = '\u2514' + colWidths.map(w => '\u2500'.repeat(w + 2)).join('\u2534') + '\u2518';

  return (
    <Box flexDirection="column">
      {!args?.['no-header'] && (
        <Box paddingX={1}>
          <Text dimColor>{title} ({rows.length} rows)</Text>
          {showScrollBar && (
            <Text dimColor> [{scroll + 1}-{Math.min(scroll + visibleRows, rows.length)}]</Text>
          )}
        </Box>
      )}

      <Box flexDirection="row">
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          {/* Top border */}
          <Text dimColor>{topBorder}</Text>

          {/* Header row */}
          <Text>
            <Text dimColor>{'\u2502'}</Text>
            {columns.map((col, i) => (
              <Text key={col}>
                <Text bold color="cyan"> {truncate(col, colWidths[i])} </Text>
                <Text dimColor>{'\u2502'}</Text>
              </Text>
            ))}
          </Text>

          {/* Header separator */}
          <Text dimColor>{headerSep}</Text>

          {/* Data rows */}
          {displayRows.map((row, displayIdx) => {
            const actualIdx = scroll + displayIdx;
            const isSelected = selectMode && actualIdx === selectedRow;

            return (
              <Text key={actualIdx} inverse={isSelected}>
                <Text dimColor>{'\u2502'}</Text>
                {columns.map((col, i) => (
                  <Text key={col}>
                    <Text> {truncate(String(row[col] ?? ''), colWidths[i])} </Text>
                    <Text dimColor>{'\u2502'}</Text>
                  </Text>
                ))}
              </Text>
            );
          })}

          {/* Bottom border */}
          <Text dimColor>{bottomBorder}</Text>
        </Box>

        {showScrollBar && (
          <ScrollBar position={scrollPosition} height={displayRows.length + 3} />
        )}
      </Box>

      <Box paddingX={1}>
        <Text dimColor>
          ↑↓/jk=scroll  PgUp/PgDn  {selectMode ? 'Enter=select  ' : ''}q=close
          {showScrollBar ? '  mouse=scroll' : ''}
        </Text>
      </Box>
    </Box>
  );
}
