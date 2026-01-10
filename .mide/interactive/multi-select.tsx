import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;
declare const args: { prompt?: string; options?: string };

function MultiSelect() {
  const { exit } = useApp();
  const options = (args.options || 'Option 1,Option 2,Option 3').split(',').map(s => s.trim());
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setCursor(c => (c - 1 + options.length) % options.length);
    } else if (key.downArrow || input === 'j') {
      setCursor(c => (c + 1) % options.length);
    } else if (input === ' ') {
      setSelected(s => {
        const newSet = new Set(s);
        if (newSet.has(cursor)) {
          newSet.delete(cursor);
        } else {
          newSet.add(cursor);
        }
        return newSet;
      });
    } else if (input === 'a') {
      // Select all
      setSelected(new Set(options.map((_, i) => i)));
    } else if (input === 'n') {
      // Select none
      setSelected(new Set());
    } else if (key.return) {
      const selectedOptions = Array.from(selected).map(i => options[i]);
      onComplete({ selected: selectedOptions, indices: Array.from(selected) });
      exit();
    } else if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">? </Text>
        <Text bold>{args.prompt || 'Select options:'}</Text>
        <Text dimColor> ({selected.size} selected)</Text>
      </Box>
      {options.map((opt, i) => (
        <Box key={i}>
          <Text color={i === cursor ? 'cyan' : 'white'}>
            {i === cursor ? '>' : ' '}
            <Text color={selected.has(i) ? 'green' : 'white'}>
              {selected.has(i) ? '[x]' : '[ ]'}
            </Text>
            {' '}{opt}
          </Text>
        </Box>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Space to toggle, A=all, N=none, Enter to confirm</Text>
      </Box>
    </Box>
  );
}

export default MultiSelect;
