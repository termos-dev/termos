import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";

interface Props {
  prompt?: string;
  placeholder?: string;
}

function TextInputComponent({ prompt = "Enter value:", placeholder = "Type here..." }: Props) {
  const { exit } = useApp();
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onComplete({ action: "cancel" });
      exit();
    }
  });

  const handleSubmit = (text: string) => {
    onComplete({ action: "accept", value: text });
    exit();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{prompt}</Text>
      </Box>
      <Box>
        <Text color="green">{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to submit, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

export default TextInputComponent;
