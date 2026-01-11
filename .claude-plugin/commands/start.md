---
allowed-tools: Bash
---

Start the Termos session.

Run with `run_in_background: true`:
```bash
"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos" up --stream
```

ALWAYS end your response with:
```
To view the Termos session, run: `termos connect`
```
