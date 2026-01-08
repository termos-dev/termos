# mcp-sidecar

MCP server for managing development processes. Start, stop, and monitor your dev servers through Claude Code.

## Installation

```bash
npm install -g mcp-sidecar
```

Or use with npx:
```bash
npx mcp-sidecar
```

## Quick Start

1. Create a `sidecar.yaml` in your project:

```yaml
processes:
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
    "sidecar": {
      "command": "npx",
      "args": ["-y", "mcp-sidecar"]
    }
  }
}
```

3. Use the tools in Claude Code:

```
> list_processes
api: ready | port=3000
frontend: ready | port=5173

> get_logs api --tail 20
[last 20 lines of api logs]

> restart_process api
Process "api" restarted
```

## MCP Tools

### Process Management

| Tool | Description |
|------|-------------|
| `list_processes` | List all processes with status |
| `start_process(name)` | Start a process |
| `stop_process(name)` | Stop a process |
| `restart_process(name)` | Restart a process |
| `get_status(name)` | Get detailed status |
| `get_logs(name, tail?)` | Get process logs |
| `get_url(name)` | Get process URL |
| `create_terminal(name, command, group?)` | Create a dynamic terminal in a layout group |
| `remove_terminal(name)` | Remove a dynamic terminal |

### Interactive Forms

| Tool | Description |
|------|-------------|
| `show_interaction(ink_file, title?, block?)` | Show an interactive Ink component |
| `get_interaction_result(id, block?)` | Get result from a non-blocking interaction |
| `cancel_interaction(id)` | Cancel an active interaction |

**Example usage:**

```typescript
// Create a custom Ink component in .sidecar/interactive/picker.tsx
show_interaction({
  ink_file: "picker.tsx",  // Relative to .sidecar/interactive/
  title: "Select an option",
  block: true  // Wait for user response
})
// Returns: { action: "accept", result: { selected: "Option A" } }
```

Custom Ink components should:
- Export a default React component
- Call `onComplete(result)` when done
- Use `useApp().exit()` to close

See `.sidecar/interactive/demo.tsx` for an example.

## Configuration

### Process Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `command` | string | required | Shell command to run |
| `cwd` | string | config dir | Working directory (relative to config) |
| `port` | number | auto-detect | Fixed port (injected as `$PORT` env var) |
| `force` | boolean | false | Kill existing process on port |
| `autoStart` | boolean | true | Start automatically on boot |
| `env` | object | {} | Environment variables |
| `envFile` | string | none | Path to .env file |
| `restartPolicy` | string | "onFailure" | `always`, `onFailure`, or `never` |
| `maxRestarts` | number | 5 | Max restart attempts |
| `healthCheck` | string | none | HTTP path for health checks |
| `dependsOn` | string/array | none | Process dependencies |
| `stdoutPatternVars` | object | none | Regex patterns to extract variables from output |
| `readyVars` | array | none | Variables required before process is "ready" |

### Settings

```yaml
settings:
  # Process management
  logBufferSize: 1000        # Log lines to keep per process
  healthCheckInterval: 10000  # Health check interval (ms)
  dependencyTimeout: 60000    # Dependency wait timeout (ms)
  restartBackoffMax: 30000    # Max restart backoff (ms)
  processStopTimeout: 5000    # Graceful stop timeout (ms)

  # Tmux settings
  tmuxSessionPrefix: sidecar  # Prefix for tmux session names
  layout: grid                # Default pane layout

  # Terminal settings
  autoAttachTerminal: true    # Auto-open terminal on start
  terminalApp: auto           # auto, ghostty, iterm, kitty, terminal
```

### Layout

Control how processes are arranged in the tmux session.

**Simple presets** (top-level shortcut):

```yaml
layout: grid        # Automatic grid (default)
layout: horizontal  # All processes side by side
layout: vertical    # All processes stacked
layout: main-left   # First process large on left, others stacked right
layout: main-top    # First process large on top, others below
```

**Grouped layouts** with named groups:

```yaml
# 2x2 grid with named groups
layout:
  type: rows
  groups:
    servers: [frontend, backend]   # top row
    tools: [worker, api]           # bottom row

# Or arrange as columns
layout:
  type: columns
  groups:
    left: [frontend, worker]       # left column
    right: [backend, api]          # right column
```

Named groups enable dynamic terminals - use `create_terminal(name, command, group)` to add terminals to specific groups at runtime.

### Port Detection

Ports are automatically detected from process output. Common patterns:
- `Local: http://localhost:5173`
- `Server listening on port 3000`
- `http://localhost:PORT`

### Variable Extraction

Extract values from process output using regex patterns:

```yaml
processes:
  vite:
    command: npm run dev
    stdoutPatternVars:
      url: "Local:\\s+(http://[^\\s]+)"
      network: "Network:\\s+(http://[^\\s]+)"
    readyVars: [url]  # Process is "ready" when these vars are captured
```

Captured variables are available via `get_status(name)`.

### Restart Policies

- **`always`**: Restart on any exit (daemon-style)
- **`onFailure`**: Restart only on non-zero exit (default)
- **`never`**: Run once, don't restart (for build steps)

### Dependencies

```yaml
processes:
  db:
    command: docker compose up postgres
    port: 5432

  api:
    command: npm run dev
    dependsOn: db
```

## License

MIT
