# Claude IDE Project Instructions

## Local Development Alias

To use `mide` command locally during development:

```bash
# Add to ~/.zshrc for persistent alias
echo 'alias mide="/Users/burakemre/Code/ai-experiments/mcp-sidecar/.claude-plugin/scripts/mide.sh"' >> ~/.zshrc
source ~/.zshrc

# Or for current session only
alias mide="/Users/burakemre/Code/ai-experiments/mcp-sidecar/.claude-plugin/scripts/mide.sh"
```

Then run:
```bash
mide connect    # Attach to tmux session
mide status     # Show service status
mide up         # Start services in background
mide down       # Stop services
```

## Testing

Run the MCP server and test with Claude Code:

```bash
# Create an mide.yaml in any project directory
cd /path/to/project
npx mcp-ide

# Or run from this repo
node dist/index.js
```

Then use the IDE tools (`start_process`, `stop_process`, `get_logs`, `get_status`, etc.) to manage processes.

## Verifying Implementations

When making changes to the CLI or tmux-related code, always test in a real tmux session:

```bash
# Create a test session
tmux new-session -d -s test-session -c /Users/burakemre/Code/ai-experiments/mcp-sidecar

# Run commands inside tmux
tmux send-keys -t test-session './your-command-here' Enter

# Capture output to verify
sleep 1 && tmux capture-pane -t test-session -p

# Clean up
tmux kill-session -t test-session
```

This proves the implementation works in the actual environment users will run it in.

## Screenshots

Never change window focus to take screenshots - this disrupts the user's workflow.

Use window-specific capture instead:
```bash
# List windows to find the window ID
osascript -e 'tell app "System Events" to get {name, id} of every window of every process'

# Capture specific window by ID (doesn't change focus)
screencapture -l <window_id> /tmp/screenshot.png
```
