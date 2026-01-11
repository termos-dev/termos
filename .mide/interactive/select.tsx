import React from "react";
import { Box, Text, useInput, useApp } from "ink";
import SelectInput from "ink-select-input";

interface Props {
  prompt?: string;
  options?: string;  // Comma-separated options
}

function SelectComponent({ prompt = "Select an option:", options = "Option A,Option B,Option C" }: Props) {
  const { exit } = useApp();

  const items = options.split(",").map((opt) => ({
    label: opt.trim(),
    value: opt.trim(),
  }));

  useInput((input, key) => {
    if (key.escape) {
      onComplete({ action: "cancel" });
      exit();
    }
  });

  const handleSelect = (item: { label: string; value: string }) => {
    onComplete({ action: "accept", selected: item.value });
    exit();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{prompt}</Text>
      </Box>
      <SelectInput items={items} onSelect={handleSelect} />
      <Box marginTop={1}>
        <Text dimColor>Use arrows to select, Enter to confirm, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

export default SelectComponent;
