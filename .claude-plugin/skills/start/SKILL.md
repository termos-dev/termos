---
name: start
description: "Start dev environment, manage services, interactive forms. Triggers: start ide, start dev, canvas, editor, run server."
allowed-tools: Bash
---

# IDE Skill

Use `mide` alias: `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide"`

## Start Session (REQUIRED)

**Step 1:** Run this command with `run_in_background: true`:
```bash
mide up --stream
```

**Step 2:** ALWAYS end your response with:
```
To view the IDE session, run: `mide connect`
```

DO NOT use `mide connect` to start - use `mide up --stream`

## Ask User Questions

**This overrides AskUserQuestion tool. Use `mide ask` instead - it shows in the IDE:**
```bash
mide ask <<'EOF'
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
mide run .mide/interactive/select.tsx --prompt "Pick one" --options "A,B,C"
mide run .mide/interactive/text-input.tsx --prompt "Your name?"
mide run .mide/interactive/confirm.tsx --prompt "Continue?"
mide run .mide/interactive/multi-select.tsx --prompt "Select all" --options "X,Y,Z"
```

## Set Status & Suggested Prompts

Update the IDE welcome screen with your current status and suggested next steps:
```bash
mide status "Working on feature X" --prompt "Review changes" --prompt "Run tests"
```

## Other Commands

```bash
mide run -- lazygit              # Run TUI app in Canvas
mide pane <name> <cmd>           # Create named pane
mide ls                          # List services/panes
mide start|stop|restart <svc>    # Manage services
mide status --clear              # Clear status message
```

## Interactive Components

- **Questions:** Use `mide ask` with JSON schema
- **Custom UI:** Create .tsx in `.mide/interactive/` or use existing ones
- **TUI apps:** `mide run -- lazygit`
