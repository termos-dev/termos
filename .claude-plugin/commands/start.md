---
allowed-tools: Bash
---

Start the IDE session.

Run with `run_in_background: true`:
```bash
"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide" up --stream
```

ALWAYS end your response with:
```
To view the IDE session, run: `mide connect`
```
