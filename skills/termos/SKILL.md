---
name: termos
description: Run Termos interactive UI inside Zellij for Codex sessions. Use when the user asks for interactive questions, confirmations, checklists, tables, code/diff/markdown/mermaid views, or any Termos UI.
---

# Termos

## Quick Start

Run inside a Zellij session (or on macOS without Zellij):
```bash
termos run --title "Confirm" confirm --prompt "Proceed?"
termos wait <id>  # or use `termos result` for non-blocking
```

## REQUIRED: Learn Component Args

Before using any component, run:
```bash
termos run --help
```

This prints all component arguments. Do NOT guess argument names.

On macOS without Zellij, Termos will open Ghostty if available, otherwise a Terminal tab for each interaction.

`--title` is required for all `termos run` invocations.

## Background processes (Codex/Claude skills only)

- Do not use Codex/Claude background-process tools.
- Do not use shell backgrounding (`&`) for long-running tasks.
- All background/long-running processes must be started with `termos run -- <command>` so they live in their own Zellij tab/pane.

Example:
```bash
termos run --title "HTTP Server" -- python3 -m http.server 8080
```

## Position Presets

Use `--position <preset>` to control where interactions appear:

**Floating (overlay panes):**
- `floating` - Top-right (default for components)
- `floating:center` - Centered
- `floating:top-left` - Top-left corner
- `floating:top-right` - Top-right corner
- `floating:bottom-left` - Bottom-left corner
- `floating:bottom-right` - Bottom-right corner

**Split (Zellij only - integrated into layout):**
- `split` - Auto-detect direction based on terminal size
- `split:right` - Side-by-side split
- `split:down` - Stacked split

**Tab:**
- `tab` - New tab (default for commands)

Examples:
```bash
# Floating (default for components)
termos run --title "Confirm" confirm --prompt "Proceed?"

# Centered floating pane
termos run --title "Question" --position floating:center ask --prompt "Name?"

# Split pane (Zellij only)
termos run --title "Review" --position split confirm --prompt "Approve changes?"

# Tab (default for commands)
termos run --title "Server" -- python3 -m http.server 8080
```

Note: Split positions only work in Zellij. On macOS without Zellij, split falls back to a new window.

## Async Workflow (IMPORTANT)

`termos run` returns immediately with an interaction ID. You can wait for results or check them later.

**Correct pattern:**
```bash
# Fire multiple interactions at once
termos run --title "Q1" --position floating:top-left confirm --prompt "Approve?"
termos run --title "Q2" --position floating:top-right checklist --items "A,B,C"
# Continue working, then check results:
termos result  # all results
termos wait <id>  # wait for specific one
```

**Anti-pattern (don't do this):**
- Run command → wait for result → run next command

## Ask component

Single question:
```bash
termos run --title "Question" ask --prompt "What is your name?" --placeholder "Enter your name..."
```

Single question with choices:
```bash
termos run --title "Question" ask --prompt "Favorite language?" --options "TypeScript,Python,Go"
```

Multiple questions (inline JSON array):
```bash
termos run --title "Question" ask --questions '[{"question":"Name?","options":["Alice","Bob"]}]'
```

