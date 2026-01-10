---
name: start
description: "Start dev environment, manage services, interactive forms. Triggers: start ide, start dev, canvas, editor, run server."
allowed-tools: Bash
---

# IDE Skill

## For Agents (headless mode)

Start services and wait for ready status with JSON output:

```bash
"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" up --json
```

This will:
- Start all services defined in mide.yaml
- Wait for services to become ready (up to 60s)
- Stream events as JSON during startup
- Return final status as JSON

For immediate return (non-blocking):

```bash
"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" up -d --json
```

Then monitor events in background:

```bash
tail -f /tmp/mide-<session>/events.jsonl
```

## For Users (interactive mode)

To open the tmux session for the user to view:

```bash
"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" connect
```

The output will tell the user how to view the session (either in a split pane if they're in tmux, or the attach command if not).

## Other commands

- `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" ls` - list services and logs
- `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" down` - stop session
- `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" up -d` - start detached (human output)
- `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" up --json` - start and wait (JSON output)
