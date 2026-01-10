import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;
declare const args: { prompt?: string; options?: string };

function Select() {
  const { exit } = useApp();
  const options = (args.options || 'Option 1,Option 2,Option 3').split(',').map(s => s.trim());
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelected(s => (s - 1 + options.length) % options.length);
    } else if (key.downArrow || input === 'j') {
      setSelected(s => (s + 1) % options.length);
    } else if (key.return) {
      onComplete({ value: options[selected], index: selected });
      exit();
    } else if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    } else {
      // Number keys for quick selection
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        onComplete({ value: options[num - 1], index: num - 1 });
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="blue">? </Text>
        <Text bold>{args.prompt || 'Select an option:'}</Text>
      </Box>
      {options.map((opt, i) => (
        <Box key={i}>
          <Text color={i === selected ? 'cyan' : 'white'}>
            {i === selected ? '> ' : '  '}
            <Text dimColor>{i + 1}.</Text> {opt}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Use arrows or number keys, Enter to select</Text>
      </Box>
    </Box>
  );
}

export default Select;
