import React, { useEffect } from "react";
import { Box, Text, useInput } from "ink";

declare const args: {
  sessionName?: string;
  services?: Array<{
    name: string;
    windowIndex: number;
    status: string;
    restartCount: number;
    port?: number;
    healthy?: boolean;
  }>;
  projectInteractive?: string[];  // .mide/interactive/
  globalInteractive?: string[];   // ~/.mide/interactions/
};

const STATUS_COLORS: Record<string, string> = {
  running: "green",
  ready: "green",
  starting: "yellow",
  stopped: "gray",
  crashed: "red",
  completed: "cyan",
};

const STATUS_ICONS: Record<string, string> = {
  running: "●",
  ready: "●",
  starting: "◐",
  stopped: "○",
  crashed: "✗",
  completed: "✓",
};

// Example prompts for each interactive component
const INTERACTIVE_EXAMPLES: Record<string, string> = {
  "confirm": "Ask the user to confirm before deploying",
  "select": "Let the user pick which environment to deploy to",
  "multi-select": "Ask user which features to enable",
  "text-input": "Get the user's API key",
  "number-input": "Ask user how many replicas to create",
  "color-picker": "Let user choose a theme color",
  "auto-complete": "Help user select a file from suggestions",
};

function Welcome() {
  // Ignore all input - this component should never exit
  useInput(() => {});

  // Ignore SIGINT/SIGTERM
  useEffect(() => {
    const ignore = () => {};
    process.on("SIGINT", ignore);
    process.on("SIGTERM", ignore);
    return () => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", ignore);
    };
  }, []);

  const sessionName = args?.sessionName || "mide";
  const services = args?.services || [];
  const projectInteractive = args?.projectInteractive || [];
  const globalInteractive = args?.globalInteractive || [];

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">mide</Text>
      <Text dimColor>Session: {sessionName}</Text>
      <Text> </Text>

      {services.length > 0 && (
        <>
          <Text bold>Services</Text>
          {services.map((svc) => {
            const color = STATUS_COLORS[svc.status] || "white";
            const icon = STATUS_ICONS[svc.status] || "?";
            const portInfo = svc.port ? `:${svc.port}` : "";
            const restartInfo = svc.restartCount > 0 ? ` (${svc.restartCount}x)` : "";

            return (
              <Text key={svc.name}>
                <Text color="yellow">{svc.windowIndex}</Text>
                <Text dimColor> </Text>
                <Text color={color}>{icon}</Text>
                <Text> {svc.name}</Text>
                <Text dimColor>{portInfo}{restartInfo}</Text>
              </Text>
            );
          })}
          <Text> </Text>
        </>
      )}

      <Text bold>Service Commands</Text>
      <Text dimColor>Ask Claude to manage your dev environment:</Text>
      <Text color="green">  "Start the API server"</Text>
      <Text color="green">  "Show me the logs for redis"</Text>
      <Text color="green">  "Restart the frontend"</Text>
      <Text> </Text>

      {projectInteractive.length > 0 && (
        <>
          <Text bold>Project Interactive <Text dimColor>(.mide/interactive/)</Text></Text>
          {projectInteractive.map((file) => {
            const name = file.replace('.tsx', '');
            const example = INTERACTIVE_EXAMPLES[name] || `Use ${name} component`;
            return (
              <Text key={file}>
                <Text color="yellow">  {name.padEnd(14)}</Text>
                <Text dimColor>"{example}"</Text>
              </Text>
            );
          })}
          <Text> </Text>
        </>
      )}

      {globalInteractive.length > 0 && (
        <>
          <Text bold>Global Interactive <Text dimColor>(~/.mide/interactions/)</Text></Text>
          {globalInteractive.map((file) => {
            const name = file.replace('.tsx', '');
            const example = INTERACTIVE_EXAMPLES[name] || `Use ${name} component`;
            return (
              <Text key={file}>
                <Text color="yellow">  {name.padEnd(14)}</Text>
                <Text dimColor>"{example}"</Text>
              </Text>
            );
          })}
          <Text> </Text>
        </>
      )}

      <Text bold>Navigation</Text>
      <Text><Text dimColor>Ctrl-b</Text> <Text color="yellow">0-9</Text> <Text dimColor>Switch windows</Text></Text>
      <Text><Text dimColor>Ctrl-b</Text> <Text color="yellow">d</Text> <Text dimColor>  Detach session</Text></Text>
    </Box>
  );
}

export default Welcome;
