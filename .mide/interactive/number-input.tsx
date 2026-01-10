import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;
declare const args: { prompt?: string; min?: string; max?: string; step?: string; defaultValue?: string };

function NumberInput() {
  const { exit } = useApp();
  const min = parseInt(args.min || '0', 10);
  const max = parseInt(args.max || '100', 10);
  const step = parseInt(args.step || '1', 10);
  const defaultVal = parseInt(args.defaultValue || String(min), 10);

  const [value, setValue] = useState(defaultVal);
  const [inputMode, setInputMode] = useState(false);
  const [inputBuffer, setInputBuffer] = useState('');

  useInput((input, key) => {
    if (inputMode) {
      if (key.return) {
        const parsed = parseInt(inputBuffer, 10);
        if (!isNaN(parsed)) {
          setValue(Math.max(min, Math.min(max, parsed)));
        }
        setInputMode(false);
        setInputBuffer('');
      } else if (key.escape) {
        setInputMode(false);
        setInputBuffer('');
      } else if (key.backspace) {
        setInputBuffer(b => b.slice(0, -1));
      } else if (/[0-9-]/.test(input)) {
        setInputBuffer(b => b + input);
      }
      return;
    }

    if (key.upArrow || input === 'k' || input === '+') {
      setValue(v => Math.min(max, v + step));
    } else if (key.downArrow || input === 'j' || input === '-') {
      setValue(v => Math.max(min, v - step));
    } else if (key.leftArrow) {
      setValue(v => Math.max(min, v - step * 10));
    } else if (key.rightArrow) {
      setValue(v => Math.min(max, v + step * 10));
    } else if (input === 'e' || input === 'i') {
      setInputMode(true);
      setInputBuffer(String(value));
    } else if (key.return) {
      onComplete({ value });
      exit();
    } else if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    }
  });

  const percentage = ((value - min) / (max - min)) * 100;
  const barWidth = 20;
  const filled = Math.round((percentage / 100) * barWidth);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">? </Text>
        <Text bold>{args.prompt || 'Enter a number:'}</Text>
      </Box>

      {inputMode ? (
        <Box>
          <Text color="cyan">&gt; </Text>
          <Text>{inputBuffer}</Text>
          <Text inverse> </Text>
          <Text dimColor> (Enter to confirm, Esc to cancel)</Text>
        </Box>
      ) : (
        <>
          <Box>
            <Text color="cyan" bold>{value}</Text>
            <Text dimColor> ({min} - {max})</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">[</Text>
            <Text color="green">{'█'.repeat(filled)}</Text>
            <Text color="gray">{'░'.repeat(barWidth - filled)}</Text>
            <Text color="gray">]</Text>
            <Text dimColor> {percentage.toFixed(0)}%</Text>
          </Box>
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑/↓ ±{step}, ←/→ ±{step * 10}, E=edit, Enter=confirm</Text>
      </Box>
    </Box>
  );
}

export default NumberInput;
