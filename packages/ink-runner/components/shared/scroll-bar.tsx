import { Box, Text } from 'ink';

interface ScrollBarProps {
  /** Scroll position from 0 to 1 */
  position: number;
  /** Height of the scroll bar in rows */
  height: number;
}

/**
 * Visual scroll indicator bar component
 */
export function ScrollBar({ position, height }: ScrollBarProps) {
  const trackHeight = Math.max(3, height);
  const thumbSize = Math.max(1, Math.floor(trackHeight * 0.2));
  const thumbPos = Math.floor(position * (trackHeight - thumbSize));

  const chars: string[] = [];
  for (let i = 0; i < trackHeight; i++) {
    if (i >= thumbPos && i < thumbPos + thumbSize) {
      chars.push('\u2588'); // Full block
    } else {
      chars.push('\u2591'); // Light shade
    }
  }

  return (
    <Box flexDirection="column" marginLeft={1}>
      {chars.map((char, i) => (
        <Text key={i} color="gray">{char}</Text>
      ))}
    </Box>
  );
}
