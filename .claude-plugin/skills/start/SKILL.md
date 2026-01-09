---
name: start
description: "Start dev environment, create terminals/panes, show Ink components and interactive forms, manage processes. Triggers: start dev, run server, create terminal, open pane, ink component, ask question, show form, interactive input, process status, dashboard, TUI."
allowed-tools: mcp__plugin_ide_ide__*
---

# IDE Start Skill

Start and manage your development environment with terminals, processes, interactive Ink components, and dashboards.

## Starting the Environment

When the user wants to start their dev environment, use `list_processes` to initialize and show all processes from `mide.yaml`. This will:
1. Create the tmux session
2. Start all auto-start processes
3. Open the terminal window (if configured)

```
list_processes()  // Initializes environment and shows status
```

## Terminal & Pane Tools

### `create_pane`
Create a terminal pane running any command. Use for dev servers, build commands, or any shell process.
```
create_pane(name: "dev-server", command: "npm run dev")
create_pane(name: "tests", command: "npm test --watch", group: "tools")
```

### `remove_pane`
Remove a terminal pane by name.

## Interactive Ink Components

### `show_interaction`
Show interactive Ink components for user input, TUI dashboards, or any terminal UI.

**Schema mode** - Define forms inline (no file needed):
```
show_interaction(
  schema: {
    questions: [
      { question: "What's your name?", header: "Name", inputType: "text" },
      { question: "Select role", header: "Role", options: [
        { label: "Developer", description: "Write code" },
        { label: "Designer", description: "Create designs" }
      ]}
    ]
  },
  title: "User Setup"
)
```

**File mode** - Run custom Ink components (.tsx/.jsx files):
```
show_interaction(ink_file: "color-picker.tsx", title: "Pick a Color")
show_interaction(ink_file: "dashboard.tsx")
```

File resolution order:
1. Absolute paths used as-is
2. Project `.mide/interactive/` directory
3. Global `~/.mide/interactive/` directory

### `get_interaction_result`
Get result from a non-blocking interaction (when `block: false`).

### `cancel_interaction`
Cancel a pending interaction.

## Writing Custom Ink Components

Create `.tsx` files in `.mide/interactive/` (project) or `~/.mide/interactive/` (global):

```tsx
import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

// onComplete is injected globally - call it to return data
declare const onComplete: (result: unknown) => void;

function MyComponent() {
  const { exit } = useApp();
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.return) {
      onComplete({ selected: value });  // Return data to Claude
      exit();                            // Close the component
    }
    if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>My Interactive Component</Text>
      <Text>Press Enter to confirm, Escape to cancel</Text>
    </Box>
  );
}

export default MyComponent;  // Must have default export
```

**Available imports:**
- `ink` - Box, Text, useInput, useApp, useFocus, Newline, Spacer, Static, Transform
- `ink-text-input` - TextInput component
- `ink-select-input` - SelectInput component
- `react` - useState, useEffect, useMemo, useCallback, etc.

**Key patterns:**
- `useInput((input, key) => {...})` - Handle keyboard input
- `useApp().exit()` - Close the component
- `onComplete(data)` - Return result to Claude (global function)
- `useState` - Manage component state

### `set_status`
Update the terminal window title/status indicator.

## Process Management (requires `mide.yaml`)

- `list_processes` - Overview of all processes (also initializes environment)
- `get_status` - Detailed status of a single process
- `get_logs` - Get stdout/stderr logs
- `get_url` - Get the preview URL for a process
- `start_process` - Start a stopped process
- `stop_process` - Stop a running process
- `restart_process` - Restart a process

## When to Use

| User Intent | Tool |
|-------------|------|
| "start dev environment" | `list_processes` |
| "run a command in terminal" | `create_pane` |
| "ask user a question" | `show_interaction` with schema |
| "show a color picker" | `show_interaction` with ink_file |
| "create an ink component" | Write .tsx file, then `show_interaction` |
| "check if server is running" | `get_status` |
| "show me the logs" | `get_logs` |
| "restart the API" | `restart_process` |

## Best Practices

1. Use `list_processes` first to initialize the environment
2. Use `show_interaction` for structured user input instead of asking in chat
3. For simple questions, use schema mode (no file needed)
4. For complex UIs, create Ink components in `.mide/interactive/`
5. Use `create_pane` for long-running processes you want visible
6. Check process status before suggesting restarts
