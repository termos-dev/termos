import { Box, Text, useApp } from 'ink';
import { useEffect, useState } from 'react';

declare const onComplete: (result: unknown) => void;

function AutoComplete() {
  const { exit } = useApp();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          onComplete({ autoCompleted: true, timestamp: Date.now() });
          exit();
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Auto-Complete Test</Text>
      <Text>This component will auto-complete in {countdown} seconds...</Text>
    </Box>
  );
}

export default AutoComplete;
