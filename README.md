# mcp-ide

Interactive Development Environment for Claude Code. Create terminal panes, show interactive Ink components & forms, manage dev services, build TUI dashboards.

## Installation

```bash
npm install -g mcp-ide
```

Or use with npx:
```bash
npx mcp-ide
```

## Quick Start

1. Create an `mide.yaml` in your project:

```yaml
services:
  api:
    command: npm run dev
    port: 3000

  frontend:
    command: npm run dev
    cwd: ./frontend
```

2. Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "ide": {
      "command": "npx",
      "args": ["-y", "mcp-ide"]
    }
  }
}
```

3. Use `/ide:start` or ask Claude to manage your dev environment:

```
> /ide:start
> "start my dev servers"
> "show me the API logs"
> "restart the frontend"
```

## MCP Tools (8 total)

### Service Management

| Tool | Description |
|------|-------------|
| `list_services` | List all services with status, port, URL, health |
| `manage_service(name, op)` | Start, stop, or restart a service |

### Panes

| Tool | Description |
|------|-------------|
| `create_pane(name, command)` | Create a terminal pane |
| `show_user_interaction(schema?, ink_file?)` | Show interactive Ink form/component to user |
| `remove_pane(name)` | Remove a pane |
| `capture_pane(name, lines?)` | Capture terminal output (works for panes and services) |
| `get_user_interaction(id)` | Get result from completed interaction |

### Status

| Tool | Description |
|------|-------------|
| `set_status(status, message?)` | Update window title/status |

## Interactive Ink Components

**Schema mode** - Define forms inline:
```typescript
show_user_interaction({
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
})
// Returns: { action: "accept", answers: { Name: "John", Role: "Developer" } }
```

**File mode** - Run custom Ink components:
```typescript
show_user_interaction({
  ink_file: "color-picker.tsx",  // Relative to .mide/interactive/
  title: "Pick a Color"
})
// Returns: { action: "accept", result: { color: "blue" } }
```

## Writing Ink Components

Create `.tsx` files in `.mide/interactive/` (project) or `~/.mide/interactive/` (global):

```tsx
import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;

function ColorPicker() {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const colors = ['red', 'green', 'blue'];

  useInput((input, key) => {
    if (key.upArrow) setSelected(s => (s - 1 + colors.length) % colors.length);
    if (key.downArrow) setSelected(s => (s + 1) % colors.length);
    if (key.return) {
      onComplete({ color: colors[selected] });
      exit();
    }
    if (key.escape) {
      onComplete({ cancelled: true });
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Pick a color:</Text>
      {colors.map((color, i) => (
        <Text key={color} color={i === selected ? 'cyan' : 'white'}>
          {i === selected ? '> ' : '  '}{color}
        </Text>
      ))}
    </Box>
  );
}

export default ColorPicker;
```

**Available imports:** `ink`, `ink-text-input`, `ink-select-input`, `react`

**Key patterns:**
- `onComplete(data)` - Return result to Claude (global function)
- `useApp().exit()` - Close the component
- `useInput((input, key) => {...})` - Handle keyboard

See `.mide/interactive/color-picker.tsx` for a complete example.

## Configuration

### Service Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `command` | string | required | Shell command to run |
| `cwd` | string | config dir | Working directory |
| `port` | number | auto-detect | Fixed port (injected as `$PORT`) |
| `autoStart` | boolean | true | Start automatically |
| `env` | object | {} | Environment variables |
| `envFile` | string | none | Path to .env file |
| `restartPolicy` | string | "onFailure" | `always`, `onFailure`, or `never` |
| `maxRestarts` | number | 5 | Max restart attempts |
| `healthCheck` | string | none | HTTP path for health checks |
| `dependsOn` | string/array | none | Service dependencies |

### Settings

```yaml
settings:
  logBufferSize: 1000        # Log lines to keep per service
  healthCheckInterval: 10000  # Health check interval (ms)
  autoAttachTerminal: true    # Auto-open terminal on start
  terminalApp: auto           # auto, ghostty, iterm, kitty, terminal
  layout: grid                # grid, horizontal, vertical, main-left, main-top
```

### Layout

```yaml
# Simple presets
layout: grid        # Automatic grid (default)
layout: horizontal  # Side by side
layout: vertical    # Stacked

# Grouped layouts
layout:
  type: rows
  groups:
    servers: [frontend, backend]
    tools: [worker, api]
```

### Dependencies

```yaml
services:
  db:
    command: docker compose up postgres
    port: 5432

  api:
    command: npm run dev
    dependsOn: db
```

## License

MIT
