import React from "react";
import { Box, Text } from "ink";

interface TabInfo {
  name: string;
  windowIndex: number;
  type: "service" | "layout";
  status?: string;
  port?: number;
  healthy?: boolean;
}

interface WelcomeProps {
  sessionName?: string;
  tabs?: TabInfo[];
}

/**
 * Welcome component shown in window 0.
 * Displays session info and lists tabs with tmux shortcuts.
 *
 * This component stays running until killed by the system.
 */
export function Welcome({ sessionName = "mide", tabs = [] }: WelcomeProps) {
  // Separate tabs by type for display
  const serviceTabs = tabs.filter((t) => t.type === "service");
  const layoutTabs = tabs.filter((t) => t.type === "layout");

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Welcome to mide</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Session: {sessionName}</Text>
      </Box>

      {tabs.length > 0 && (
        <>
          <Box marginBottom={1}>
            <Text bold>Tabs:</Text>
          </Box>
          {tabs.map((tab) => (
            <Box key={tab.name}>
              <Text>
                <Text color={tab.type === "layout" ? "magenta" : "yellow"}>
                  {tab.name}
                </Text>
                <Text dimColor> - Ctrl-b {tab.windowIndex}</Text>
                {tab.type === "layout" && (
                  <Text dimColor> (layout)</Text>
                )}
                {tab.type === "service" && tab.status && (
                  <Text dimColor> ({tab.status})</Text>
                )}
                {tab.port && (
                  <Text dimColor> :{tab.port}</Text>
                )}
              </Text>
            </Box>
          ))}
        </>
      )}

      {tabs.length === 0 && (
        <Box marginBottom={1}>
          <Text dimColor>No tabs defined. Add tabs to mide.yaml</Text>
        </Box>
      )}

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          Create panes: mcp-ide pane {"<name>"} {"<cmd>"}
        </Text>
      </Box>
    </Box>
  );
}

export default Welcome;
