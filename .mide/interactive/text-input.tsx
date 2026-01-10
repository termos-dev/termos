import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;
declare const args: { prompt?: string; placeholder?: string; defaultValue?: string };

function TextInput() {
  const { exit } = useApp();
  const [value, setValue] = useState(args.defaultValue || '');
  const [cursorPos, setCursorPos] = useState((args.defaultValue || '').length);

  useInput((input, key) => {
    if (key.return) {
      if (value.trim()) {
        onComplete({ value: value.trim() });
        exit();
      }
    } else if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    } else if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setValue(v => v.slice(0, cursorPos - 1) + v.slice(cursorPos));
        setCursorPos(c => c - 1);
      }
    } else if (key.leftArrow) {
      setCursorPos(c => Math.max(0, c - 1));
    } else if (key.rightArrow) {
      setCursorPos(c => Math.min(value.length, c + 1));
    } else if (!key.ctrl && !key.meta && input) {
      setValue(v => v.slice(0, cursorPos) + input + v.slice(cursorPos));
      setCursorPos(c => c + input.length);
    }
  });

  const displayValue = value || args.placeholder || '';
  const isPlaceholder = !value && args.placeholder;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="green">? </Text>
        <Text bold>{args.prompt || 'Enter value:'}</Text>
      </Box>
      <Box>
        <Text color="cyan">&gt; </Text>
        <Text dimColor={!!isPlaceholder}>
          {displayValue.slice(0, cursorPos)}
          <Text inverse>{displayValue[cursorPos] || ' '}</Text>
          {displayValue.slice(cursorPos + 1)}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Type your answer, Enter to submit, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

export default TextInput;
