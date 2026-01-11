import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface Props {
  prompt?: string;
  defaultYes?: boolean;
}

function ConfirmComponent({ prompt = "Are you sure?", defaultYes = false }: Props) {
  const { exit } = useApp();
  const [selected, setSelected] = useState(defaultYes ? 0 : 1);

  useInput((input, key) => {
    if (key.escape) {
      onComplete({ action: "cancel" });
      exit();
    } else if (key.leftArrow || input === "y" || input === "Y") {
      setSelected(0);
    } else if (key.rightArrow || input === "n" || input === "N") {
      setSelected(1);
    } else if (key.return) {
      onComplete({ action: "accept", confirmed: selected === 0 });
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">{prompt}</Text>
      </Box>
      <Box gap={2}>
        <Text
          color={selected === 0 ? "green" : "white"}
          bold={selected === 0}
        >
          {selected === 0 ? "> " : "  "}[Yes]
        </Text>
        <Text
          color={selected === 1 ? "red" : "white"}
          bold={selected === 1}
        >
          {selected === 1 ? "> " : "  "}[No]
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Use arrows or Y/N, Enter to confirm, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

export default ConfirmComponent;
