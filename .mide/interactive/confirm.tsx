import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;
declare const args: { prompt?: string; defaultYes?: string };

function Confirm() {
  const { exit } = useApp();
  const [selected, setSelected] = useState(args.defaultYes === 'true' ? 0 : 1);
  const options = ['Yes', 'No'];

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') {
      setSelected(s => (s + 1) % 2);
    } else if (input === 'y' || input === 'Y') {
      onComplete({ confirmed: true });
      exit();
    } else if (input === 'n' || input === 'N') {
      onComplete({ confirmed: false });
      exit();
    } else if (key.return) {
      onComplete({ confirmed: selected === 0 });
      exit();
    } else if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">? </Text>
        <Text bold>{args.prompt || 'Are you sure?'}</Text>
      </Box>
      <Box gap={2}>
        {options.map((opt, i) => (
          <Box key={opt}>
            <Text
              color={i === selected ? 'cyan' : 'white'}
              bold={i === selected}
              inverse={i === selected}
            >
              {' '}{opt}{' '}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Y/N or use arrows and Enter</Text>
      </Box>
    </Box>
  );
}

export default Confirm;
