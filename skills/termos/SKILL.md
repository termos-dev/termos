---
name: termos
description: Run Termos interactive UI inside Zellij for Codex sessions. Use when the user asks for interactive questions, confirmations, checklists, tables, code/diff/markdown/mermaid views, or any Termos UI. Requires `termos up` running; geometry defaults apply to built-ins.
---

# Termos

## Quick Start

Run inside a Zellij session (or on macOS without Zellij) and start the event stream as a background/base process:
```bash
termos up
```
Keep `termos up` running to receive interaction results.

On macOS without Zellij, Termos will open a Terminal tab for each interaction. Geometry is ignored.
If `termos up` and `termos run` are in different directories, set `TERMOS_SESSION_NAME` for both.

## Geometry (defaults for built-ins)

Built-in components can omit geometry and default to top-right:
`--width 40 --height 50 --x 60 --y 5`.
Custom components and `termos run -- <command>` require geometry (0–100).

Example with explicit geometry:
```bash
termos run --width 40 --height 50 --x 60 --y 5 confirm --prompt "Proceed?"
```
Use different x/y values to avoid stacked panes.
Think of geometry as percent-of-screen:
- `width/height` = size, `x/y` = top-left offset
- Avoid bottom-left (keep it free for typing).
- Example placements that don't overlap:
  - Top-right: `--width 40 --height 45 --x 60 --y 5`
  - Bottom-right: `--width 40 --height 45 --x 60 --y 55`
  - Top-left: `--width 40 --height 45 --x 0 --y 5`

## Use `termos run` (async)

`termos run` is async by default. Overuse it to keep the user engaged and visible in the UI.

## Ask component

Single question:
```bash
termos run ask --prompt "What is your name?" --placeholder "Enter your name..."
```

Single question with choices:
```bash
termos run ask --prompt "Favorite language?" --options "TypeScript,Python,Go"
```

Multiple questions (inline JSON array):
```bash
termos run ask --questions '[{"question":"Name?","options":["Alice","Bob"]}]'
```

## Docs for LLMs

`termos up` prints the full component help text.
You can also run:
```bash
termos run --help
```
