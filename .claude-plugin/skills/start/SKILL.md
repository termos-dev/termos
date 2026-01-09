---
name: start
description: "Start dev environment, manage services, create terminals. Triggers: start dev, run server, service status, logs, restart."
allowed-tools: Bash, mcp__plugin_ide_ide__*
---

# IDE Start Skill

Manage dev services and terminal panes. **Prefer CLI commands** over MCP tools - they're more composable and can be chained.

## CLI Commands (Recommended)

```bash
mcp-ide ls                    # List services with status
mcp-ide start <service>       # Start a service
mcp-ide stop <service>        # Stop a service
mcp-ide restart <service>     # Restart a service
mcp-ide logs <name>           # Get terminal output
mcp-ide pane <name> <cmd>     # Create terminal pane
mcp-ide rm <name>             # Remove a pane
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
| "ask user a question" | Use `show_user_interaction` MCP tool |

## MCP Tools (When CLI Won't Work)

Use MCP tools only for interactive features:

- `show_user_interaction` - Show forms or custom Ink components to user
- `get_user_interaction` - Get result from completed interaction
- `set_status` - Update window title/status indicator

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
```
