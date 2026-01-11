# termos

Interactive Development Environment for Claude Code. Manage dev services, create terminal panes, show interactive forms.

## Installation

```bash
npm install -g @termosdev/cli
```

## Quick Start

1. Create `termos.yaml` in your project:

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
    "termos": {
      "command": "npx",
      "args": ["-y", "@termosdev/cli"]
    }
  }
}
```

3. Ask Claude to manage your dev environment or use CLI directly.

## CLI Commands

```bash
# Session management
termos up                    # Start session and services
termos down                  # Stop session and services
termos attach                # Attach to tmux session
termos sessions              # List active sessions

# Service management (requires running session)
termos ls                    # List services with status
termos start <service>       # Start a service
termos stop <service>        # Stop a service
termos restart <service>     # Restart a service
termos logs <name>           # Capture pane/service output

# Panes and interaction
termos pane <name> <cmd>     # Create terminal pane
termos rm <name>             # Remove a pane
termos ask <question>        # Ask user a question
termos ink <file.tsx>        # Run custom Ink component
```

## Use Cases

| Use Case | CLI | MCP Tool |
|----------|-----|----------|
| Check service status | `termos ls` | `list_services` |
| Start/stop services | `termos start api` | `manage_service` |
| View logs | `termos logs api` | `capture_pane` |
| Run one-off command | `termos pane build "npm run build"` | `create_pane` |
| Ask user a question | `termos ask "Deploy?"` | `show_user_interaction` |
| Custom Ink component | `termos ink picker.tsx` | `show_user_interaction` |

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
  sessionName: myproject-$USER  # Custom session name (supports $ENV_VAR)
  layout: grid                  # grid | horizontal | vertical | main-left | main-top
  autoAttachTerminal: true      # Auto-open terminal window
  terminalApp: auto             # auto | ghostty | iterm | kitty | terminal
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

Create `.tsx` files in `.termos/interactive/`:

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
