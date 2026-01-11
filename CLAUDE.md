# Claude IDE Project Instructions

## Local Development Alias

To use `mide` command locally during development:

```bash
# Add to ~/.zshrc for persistent alias
echo 'alias mide="/Users/burakemre/Code/ai-experiments/mcp-sidecar/.claude-plugin/scripts/mide"' >> ~/.zshrc
source ~/.zshrc

# Or for current session only
alias mide="/Users/burakemre/Code/ai-experiments/mcp-sidecar/.claude-plugin/scripts/mide"
```

Then run:
```bash
mide connect    # Attach to tmux session
mide status     # Show service status
mide up         # Start services in background
mide down       # Stop services
```

## Important: Always Use mide CLI

```bash
mide connect              # Attach to session
mide down                 # Stop session
mide sessions             # List sessions
mide ls                   # List tabs/panes
mide status               # Check service status

# During local development
node dist/index.js connect
```

## Testing

When testing from different directories, clear the plugin cache first:
```bash
rm -rf ~/.claude/plugins/cache/claude-ide
```

Then test with Claude Code:
```bash
cd /path/to/project
# Claude will use the updated plugin
```

## Verifying Implementations

When making changes to the CLI or tmux-related code, always test in a real tmux session:

```bash
# Create a test session
tmux new-session -d -s test-session -c /Users/burakemre/Code/ai-experiments/mcp-sidecar

# IMPORTANT: Always share the attach command so user can verify
echo "Attach with: tmux attach -t test-session"

# Run commands inside tmux
tmux send-keys -t test-session './your-command-here' Enter

# Capture output to verify
sleep 1 && tmux capture-pane -t test-session -p

# Clean up
tmux kill-session -t test-session
```

**CRITICAL: Never assume something is done until you show proof.** Always:
1. Share the `tmux attach -t <session>` command so user can review
2. Capture and show the pane output to prove it worked
3. **DO NOT clean up tmux sessions until user confirms it's working**
4. Wait for user confirmation before declaring success

## Sending Keys to Claude Code Sessions

Claude Code uses ink (React for terminals) with custom input handling. Regular `tmux send-keys` doesn't work reliably.

**Always use the `-l` (literal) flag:**
```bash
# CORRECT - works with Claude Code's ink UI:
tmux send-keys -t session -l "text"
tmux send-keys -t session -l "1"      # For menu selection
tmux send-keys -t session Enter        # Enter key still works without -l

# WRONG - unreliable with ink-based UIs:
tmux send-keys -t session "text"
```

**Why:** The `-l` flag sends keys literally without interpretation. Claude Code's ink input handler processes raw keystrokes, and `-l` ensures characters arrive exactly as typed.

## Screenshots

Never change window focus to take screenshots - this disrupts the user's workflow.

Use window-specific capture instead:
```bash
# List windows to find the window ID
osascript -e 'tell app "System Events" to get {name, id} of every window of every process'

# Capture specific window by ID (doesn't change focus)
screencapture -l <window_id> /tmp/screenshot.png
```
