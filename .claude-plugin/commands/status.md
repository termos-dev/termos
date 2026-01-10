---
allowed-tools: Bash
---

List all services and their status.

Run: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" ls`

Output includes:
- Service name and status
- Port (if configured)
- URL (if detected)
- Log file path (use `tail -f` to view logs)
- Events file path (for real-time events)

If no session is running, suggest running `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" connect` first.
