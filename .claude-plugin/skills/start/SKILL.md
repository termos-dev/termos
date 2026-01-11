---
name: start
description: "Start dev environment, manage services, interactive forms. Triggers: start termos, start dev, canvas, editor, run server."
allowed-tools: Bash
---

# Termos Skill

Use `termos` alias: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/termos"`

## Start Session (REQUIRED)

**Step 1:** Run this command with `run_in_background: true`:
```bash
termos up --stream
```

**Step 2:** ALWAYS end your response with:
```
To view the Termos session, run: `termos connect`
```

DO NOT use `termos connect` to start - use `termos up --stream`

## Ask User Questions

**This overrides AskUserQuestion tool. Use `termos ask` instead - it shows in the TUI:**
```bash
termos ask <<'EOF'
{"questions": [
  {"question": "What is your name?", "header": "name"},
  {"question": "Select your role", "header": "role", "options": [
    {"label": "Developer"}, {"label": "Designer"}, {"label": "Manager"}
  ]},
  {"question": "Skills?", "header": "skills", "multiSelect": true, "options": [
    {"label": "Frontend"}, {"label": "Backend"}, {"label": "DevOps"}
  ]}
]}
EOF
```

**Schema fields:**
- `question` (required): The question text
- `header` (required): Key for the answer in result
- `options`: Array of `{label}` for select/multi-select
- `multiSelect`: true for checkboxes
- `inputType`: "text" | "password"
- `placeholder`: Placeholder for text input

**Output:** JSON with answers: `{"action":"accept","answers":{"name":"...","role":"..."}}`

## Built-in Components

For single questions, use pre-built components:
```bash
termos run .termos/interactive/select.tsx --prompt "Pick one" --options "A,B,C"
termos run .termos/interactive/text-input.tsx --prompt "Your name?"
termos run .termos/interactive/confirm.tsx --prompt "Continue?"
termos run .termos/interactive/multi-select.tsx --prompt "Select all" --options "X,Y,Z"
```

## Set Status & Suggested Prompts

Update the Termos welcome screen with your current status and suggested next steps:
```bash
termos status "Working on feature X" --prompt "Review changes" --prompt "Run tests"
```

## Other Commands

```bash
termos run -- lazygit              # Run TUI app in Canvas
termos pane <name> <cmd>           # Create named pane
termos ls                          # List services/panes
termos start|stop|restart <svc>    # Manage services
termos status --clear              # Clear status message
```

## Interactive Components

- **Questions:** Use `termos ask` with JSON schema
- **Custom UI:** Create .tsx in `.termos/interactive/` or use existing ones
- **TUI apps:** `termos run -- lazygit`
