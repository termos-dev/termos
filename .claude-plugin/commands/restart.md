---
allowed-tools: Bash
---

Restart process: $ARGUMENTS

Run: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos" restart <name>`

If no process name is specified, first run `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos" ls` to list available processes and ask which one to restart.

After restarting, run `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos" ls` again to confirm the process started successfully.
