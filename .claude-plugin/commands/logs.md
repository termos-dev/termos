---
allowed-tools: Bash
---

View logs for service: $ARGUMENTS

First run `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos" ls` to get the log file paths, then use `tail` to view logs:

```bash
# List services and their log paths
"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos" ls

# View logs (last 100 lines)
tail -n 100 /tmp/termos-<session>/<service>.log

# Follow logs in real-time
tail -f /tmp/termos-<session>/<service>.log
```

If no service name is specified, first run `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos" ls` to list available services and their log paths.
