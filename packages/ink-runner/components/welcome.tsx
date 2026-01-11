import React, { useEffect } from "react";
import { Box, Text, useInput } from "ink";

declare const args: {
  sessionName?: string;
  tabs?: Array<{
    name: string;
    windowIndex: number;
    type: string;
    status?: string;
    restartCount?: number;
    port?: number;
    healthy?: boolean;
  }>;
  projectInteractive?: string[];
  globalInteractive?: string[];
  status?: string;
  prompts?: string[];
};

const STATUS_COLORS: Record<string, string> = {
  running: "green",
  ready: "green",
  starting: "yellow",
  pending: "gray",
  stopped: "gray",
  crashed: "red",
  completed: "cyan",
};

const STATUS_ICONS: Record<string, string> = {
  running: "●",
  ready: "●",
  starting: "◐",
  pending: "○",
  stopped: "○",
  crashed: "✗",
  completed: "✓",
};

// Command examples for interactive components
const INTERACTIVE_CMDS: Record<string, string> = {
  "confirm": '--prompt "Continue?"',
  "select": '--prompt "Pick" --options "a,b,c"',
  "multi-select": '--prompt "Select" --options "x,y,z"',
  "text-input": '--prompt "Enter value"',
  "color-picker": '--prompt "Pick color"',
};

function Welcome() {
  useInput(() => {});

  useEffect(() => {
    const ignore = () => {};
    process.on("SIGINT", ignore);
    process.on("SIGTERM", ignore);
    return () => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", ignore);
    };
  }, []);

  const sessionName = args?.sessionName || "termos";
  const tabs = args?.tabs || [];
  const projectInteractive = args?.projectInteractive || [];
  const globalInteractive = args?.globalInteractive || [];
  const status = args?.status;
  const prompts = args?.prompts || [];

  // Get service tabs only (not layout tabs)
  const services = tabs.filter(t => t.type === "service");

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header with status */}
      <Box>
        <Text bold color="cyan">termos</Text>
        <Text dimColor> {sessionName}</Text>
        {status && (
          <>
            <Text dimColor>  </Text>
            <Text color="yellow">⚡ {status}</Text>
          </>
        )}
      </Box>
      <Text> </Text>

      {/* Services list with contextual commands */}
      {services.length > 0 && (
        <>
          <Text bold>Services</Text>
          {services.map((svc) => {
            const color = STATUS_COLORS[svc.status || "stopped"] || "white";
            const icon = STATUS_ICONS[svc.status || "stopped"] || "?";
            const portInfo = svc.port ? `:${svc.port}` : "";
            const restartInfo = (svc.restartCount ?? 0) > 0 ? ` (${svc.restartCount}x)` : "";

            // Contextual command based on status
            const cmd = svc.status === "running" || svc.status === "ready"
              ? `termos restart ${svc.name}`
              : `termos start ${svc.name}`;

            return (
              <Text key={svc.name}>
                <Text color={color}>{icon}</Text>
                <Text> {svc.name}</Text>
                <Text dimColor>{portInfo}{restartInfo}</Text>
                <Text dimColor>  {cmd}</Text>
              </Text>
            );
          })}
          <Text> </Text>
        </>
      )}

      {/* Suggested prompts from LLM (if any) */}
      {prompts.length > 0 && (
        <>
          <Text bold>Suggested Next Steps</Text>
          {prompts.map((prompt, i) => (
            <Text key={i} color="green">  "{prompt}"</Text>
          ))}
          <Text> </Text>
        </>
      )}

      {/* Interactive components */}
      {(projectInteractive.length > 0 || globalInteractive.length > 0) && (
        <>
          <Text bold>Interactive Components</Text>
          {[...projectInteractive, ...globalInteractive].slice(0, 4).map((file) => {
            const name = file.replace('.tsx', '');
            const cmdArgs = INTERACTIVE_CMDS[name] || `--prompt "..."`;
            return (
              <Text key={file}>
                <Text dimColor>  termos run </Text>
                <Text color="yellow">{name}.tsx</Text>
                <Text dimColor> {cmdArgs}</Text>
              </Text>
            );
          })}
          <Text> </Text>
        </>
      )}

      {/* Navigation help */}
      <Text bold>Navigation</Text>
      <Text><Text dimColor>Ctrl-b</Text> <Text color="yellow">0-9</Text> <Text dimColor>Switch tabs</Text></Text>
      <Text><Text dimColor>Ctrl-b</Text> <Text color="yellow">d</Text> <Text dimColor>  Detach</Text></Text>
      <Text> </Text>

      {/* Tip */}
      <Text dimColor>Tip: Ask Claude to explain code, ask you questions, or suggest next steps.</Text>
    </Box>
  );
}

export default Welcome;
