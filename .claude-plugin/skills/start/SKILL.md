---
name: start
description: "Start dev environment, manage services, create terminals. Triggers: start dev, run server, service status, logs, restart."
allowed-tools: Bash
---

# IDE Start Skill

Manage dev services and terminal panes using CLI commands.

## Commands

```bash
mcp-ide ls                    # List services with status
mcp-ide start <service>       # Start a service
mcp-ide stop <service>        # Stop a service
mcp-ide restart <service>     # Restart a service
mcp-ide logs <name>           # Get terminal output
mcp-ide pane <name> <cmd>     # Create terminal pane
mcp-ide rm <name>             # Remove a pane
mcp-ide ask <question>        # Ask user a question (interactive)
mcp-ide ink <file.tsx>        # Run custom Ink component
mcp-ide attach [session]      # Attach to tmux session
```

## When to Use

| User Intent | Command |
|-------------|---------|
| "start dev environment" | `mcp-ide ls` |
| "check service status" | `mcp-ide ls` |
| "show logs" | `mcp-ide logs <name>` |
| "restart the API" | `mcp-ide restart api` |
| "run a command in background" | `mcp-ide pane <name> <cmd>` |
| "ask user a question" | `mcp-ide ask "question?"` |
| "show a picker/form" | `mcp-ide ink picker.tsx` |

## Examples

```bash
# Check all services
mcp-ide ls

# Restart crashed service
mcp-ide restart api

# View recent logs
mcp-ide logs api

# Run build in background
mcp-ide pane build "npm run build"

# Chain commands
mcp-ide restart api && mcp-ide logs api

# Ask user interactively
mcp-ide ask "Deploy to production?" --header Confirm
```
