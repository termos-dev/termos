# mcp-ide

Interactive Development Environment for Claude Code. Manage dev services, create terminal panes, show interactive forms.

## Installation

```bash
npm install -g mcp-ide
```

## Quick Start

1. Create `mide.yaml` in your project:

```yaml
services:
  api:
    command: npm run dev
    port: 3000

  frontend:
    command: npm run dev
    cwd: ./frontend
```

2. Add to Claude Code MCP config (`~/.claude.json`):

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

3. Ask Claude to manage your dev environment or use CLI directly.

## CLI Commands

```bash
mcp-ide ls                    # List services with status
mcp-ide start <service>       # Start a service
mcp-ide stop <service>        # Stop a service
mcp-ide restart <service>     # Restart a service
mcp-ide logs <name>           # Capture pane/service output
mcp-ide pane <name> <cmd>     # Create terminal pane
mcp-ide rm <name>             # Remove a pane
mcp-ide status <status>       # Set window status
mcp-ide attach [session]      # Attach to tmux session
mcp-ide sessions              # List active sessions
```

## Use Cases

| Use Case | CLI | MCP Tool |
|----------|-----|----------|
| Check service status | `mcp-ide ls` | `list_services` |
| Start/stop services | `mcp-ide start api` | `manage_service` |
| View logs | `mcp-ide logs api` | `capture_pane` |
| Run one-off command | `mcp-ide pane build "npm run build"` | `create_pane` |
| Ask user a question | - | `show_user_interaction` |
| Custom Ink component | - | `show_user_interaction` |

## Service Configuration

```yaml
services:
  api:
    command: npm run dev       # Required: shell command
    cwd: ./backend             # Working directory
    port: 3000                 # Fixed port (injected as $PORT)
    autoStart: true            # Start on boot (default: true)
    env:                       # Environment variables
      NODE_ENV: development
    envFile: .env              # Load from .env file
    restartPolicy: onFailure   # always | onFailure | never
    healthCheck: /health       # HTTP health check path
    dependsOn: db              # Wait for dependency
```

## Settings

```yaml
settings:
  layout: grid                # grid | horizontal | vertical | main-left | main-top
  autoAttachTerminal: true    # Auto-open terminal window
  terminalApp: auto           # auto | ghostty | iterm | kitty | terminal
```

## Interactive Forms

Show forms to collect user input:

```typescript
show_user_interaction({
  schema: {
    questions: [
      { question: "Project name?", header: "Name", inputType: "text" },
      { question: "Language?", header: "Lang", options: [
        { label: "TypeScript" },
        { label: "Python" }
      ]}
    ]
  }
})
```

## Custom Ink Components

Create `.tsx` files in `.mide/interactive/`:

```tsx
import { Text, useInput, useApp } from 'ink';

declare const onComplete: (result: unknown) => void;

export default function() {
  const { exit } = useApp();
  useInput((_, key) => {
    if (key.return) { onComplete({ done: true }); exit(); }
  });
  return <Text>Press Enter</Text>;
}
```

Run with: `show_user_interaction({ ink_file: "my-component.tsx" })`

## License

MIT
