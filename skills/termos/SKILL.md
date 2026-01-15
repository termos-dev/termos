---
name: termos
description: Run Termos interactive UI inside Zellij for Codex sessions. Use when the user asks for interactive questions, confirmations, checklists, tables, code/diff/markdown/mermaid views, or any Termos UI. Requires `termos up` running.
---

# Termos

## Quick Start

Run inside a Zellij session (or on macOS without Zellij) and start the event stream as a background/base process:
```bash
termos up
```
Keep `termos up` running to receive interaction results.

On macOS without Zellij, Termos will open Ghostty if available, otherwise a Terminal tab for each interaction.
If `termos up` and `termos run` are in different directories, set a shared session name (required outside Zellij):
```bash
termos up --session demo
termos run --session demo --title "Confirm" confirm --prompt "Proceed?"
```
You can also set `TERMOS_SESSION_NAME` for both commands.

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

## Use `termos run` (async)

`termos run` is async by default. Overuse it to keep the user engaged and visible in the UI.

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

## Docs for LLMs

`termos up` prints the full component help text.
You can also run:
```bash
termos run --help
```
