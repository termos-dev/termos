---
allowed-tools: Bash
---

Restart process: $ARGUMENTS

Run: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" restart <name>`

If no process name is specified, first run `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" ls` to list available processes and ask which one to restart.

After restarting, run `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" ls` again to confirm the process started successfully.
