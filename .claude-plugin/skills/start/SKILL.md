---
name: start
description: "Start dev environment, create terminals/panes, show Ink components and interactive forms, manage services. Triggers: start dev, run server, create terminal, open pane, ink component, ask question, show form, interactive input, service status, dashboard, TUI."
allowed-tools: mcp__plugin_ide_ide__*
---

# IDE Start Skill

Start and manage your development environment with terminals, services, interactive Ink components, and dashboards.

## Tools (8 total)

### Service Management (require mide.yaml)

| Tool | Description |
|------|-------------|
| `list_services` | List all services with status, port, URL, health |
| `manage_service(name, op)` | Start, stop, or restart a service |

### Pane Management

| Tool | Description |
|------|-------------|
| `create_pane(name, command)` | Create a terminal pane |
| `show_user_interaction(schema?, ink_file?)` | Show interactive Ink form/component to user |
| `remove_pane(name)` | Remove a pane |
| `capture_pane(name, lines?)` | Capture terminal output from pane or service |
| `get_user_interaction(id)` | Get result from completed interaction |

### Status

| Tool | Description |
|------|-------------|
| `set_status(status, message?)` | Update window title/status |

## Starting the Environment

```
list_services()  // Initializes tmux session, shows all services
```

## Managing Services

```
manage_service(name: "api", op: "start")
manage_service(name: "api", op: "stop")
manage_service(name: "api", op: "restart")
```

## Creating Terminal Panes

```
create_pane(name: "dev-server", command: "npm run dev")
create_pane(name: "tests", command: "npm test --watch")
```

## Interactive Ink Components

**Schema mode** - Define forms inline:
```
show_user_interaction(
  schema: {
    questions: [
      { question: "What's your name?", header: "Name", inputType: "text" },
      { question: "Select role", header: "Role", options: [
        { label: "Developer" },
        { label: "Designer" }
      ]}
    ]
  },
  title: "User Setup"
)
```

**File mode** - Run custom Ink components:
```
show_user_interaction(ink_file: "color-picker.tsx", title: "Pick a Color")
```

File resolution: `.mide/interactive/` → `~/.mide/interactive/`

## Writing Ink Components

Create `.tsx` files in `.mide/interactive/`:

```tsx
import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;

function MyComponent() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.return) {
      onComplete({ value: "done" });
      exit();
    }
  });

  return <Text>Press Enter to confirm</Text>;
}

export default MyComponent;
```

**Available imports:** `ink`, `ink-text-input`, `ink-select-input`, `react`

## Capturing Output

```
capture_pane(name: "dev-server", lines: 50)
// Returns last 50 lines of terminal output
// Works for both panes and services
```

## When to Use

| User Intent | Tool |
|-------------|------|
| "start dev environment" | `list_services` |
| "run a command" | `create_pane` |
| "ask user a question" | `show_user_interaction` with schema |
| "show a picker" | `show_user_interaction` with ink_file |
| "what's in the terminal" | `capture_pane` |
| "restart the API" | `manage_service(op: "restart")` |
