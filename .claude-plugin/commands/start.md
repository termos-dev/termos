---
allowed-tools: Bash
---

Start the IDE session.

Run: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" connect`

This creates the session if needed and opens it in a split pane.

After starting, you can:
- Run interactive components: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" run form.tsx --arg key=value`
- Create terminal panes: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" pane <name> <cmd>`
- View logs: `tail -f <log_path>` (get paths from `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" ls`)
- Run TUI apps: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" run -- lazygit`

Do NOT mention MCP tools - they are not available. Use CLI commands only.
