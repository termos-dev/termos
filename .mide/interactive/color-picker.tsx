import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface Props {
  prompt?: string;
}

const COLORS = [
  { name: "Red", hex: "#FF0000", ink: "red" },
  { name: "Green", hex: "#00FF00", ink: "green" },
  { name: "Blue", hex: "#0000FF", ink: "blue" },
  { name: "Yellow", hex: "#FFFF00", ink: "yellow" },
  { name: "Cyan", hex: "#00FFFF", ink: "cyan" },
  { name: "Magenta", hex: "#FF00FF", ink: "magenta" },
  { name: "White", hex: "#FFFFFF", ink: "white" },
  { name: "Gray", hex: "#808080", ink: "gray" },
];

function ColorPickerComponent({ prompt = "Pick a color:" }: Props) {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onComplete({ action: "cancel" });
      exit();
    } else if (key.upArrow) {
      setCursor((prev) => (prev - 1 + COLORS.length) % COLORS.length);
    } else if (key.downArrow) {
      setCursor((prev) => (prev + 1) % COLORS.length);
    } else if (key.return) {
      const color = COLORS[cursor];
      onComplete({ action: "accept", color: color.name, hex: color.hex });
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{prompt}</Text>
      </Box>
      <Box flexDirection="column">
        {COLORS.map((color, idx) => (
          <Box key={color.name}>
            <Text color={idx === cursor ? color.ink as any : "white"}>
              {idx === cursor ? "> " : "  "}
            </Text>
            <Text color={color.ink as any} bold={idx === cursor}>
              {"\u2588\u2588"} {color.name}
            </Text>
            <Text dimColor> ({color.hex})</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Use arrows to select, Enter to confirm, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

export default ColorPickerComponent;
