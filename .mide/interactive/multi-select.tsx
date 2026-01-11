import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface Props {
  prompt?: string;
  options?: string;  // Comma-separated options
}

function MultiSelectComponent({ prompt = "Select items:", options = "TypeScript,Python,Rust,Go" }: Props) {
  const { exit } = useApp();
  const items = options.split(",").map((opt) => opt.trim());
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useInput((input, key) => {
    if (key.escape) {
      onComplete({ action: "cancel" });
      exit();
    } else if (key.upArrow) {
      setCursor((prev) => (prev - 1 + items.length) % items.length);
    } else if (key.downArrow) {
      setCursor((prev) => (prev + 1) % items.length);
    } else if (input === " ") {
      const item = items[cursor];
      setSelected((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(item)) {
          newSet.delete(item);
        } else {
          newSet.add(item);
        }
        return newSet;
      });
    } else if (key.return) {
      onComplete({ action: "accept", selected: Array.from(selected) });
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{prompt}</Text>
      </Box>
      <Box flexDirection="column">
        {items.map((item, idx) => (
          <Box key={item}>
            <Text color={idx === cursor ? "cyan" : "white"}>
              {idx === cursor ? "> " : "  "}
              {selected.has(item) ? "[x] " : "[ ] "}
              {item}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Arrows to move, Space to toggle, Enter to confirm, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

export default MultiSelectComponent;
