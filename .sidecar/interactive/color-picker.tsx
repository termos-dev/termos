import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

// onComplete is injected globally by ink-runner
declare const onComplete: (result: unknown) => void;

const colors = ['red', 'green', 'blue', 'yellow', 'cyan', 'magenta'];

function ColorPicker() {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(s => (s - 1 + colors.length) % colors.length);
    } else if (key.downArrow) {
      setSelected(s => (s + 1) % colors.length);
    } else if (key.return) {
      onComplete({ color: colors[selected] });
      exit();
    } else if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Pick a color:</Text>
      </Box>
      {colors.map((color, i) => (
        <Box key={color}>
          <Text color={i === selected ? 'cyan' : 'white'}>
            {i === selected ? '> ' : '  '}
            <Text color={color}>{color}</Text>
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Use arrows to navigate, Enter to select, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

export default ColorPicker;
