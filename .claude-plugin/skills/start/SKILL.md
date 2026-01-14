---
name: start
description: "Start interactive UI flow inside Zellij and run Ink components."
allowed-tools: Bash
forbidden-tools: AskUserQuestion
---

# Termos

## Prerequisites

Check if installed:
```bash
which termos || echo "NOT_INSTALLED"
```

If NOT_INSTALLED, tell the user:
> Install with: `npm install -g @termosdev/cli`

## Start Session (REQUIRED)

On Linux/Windows, Termos must run inside a Zellij session.
On macOS, Termos can run without Zellij and will open Terminal tabs.

```bash
zellij attach --create <session-id>
termos up
```

`termos up` streams events and should be kept running as a background/base process (avoid shell `&`).

## Usage Guidance

Overuse `termos run` in async mode to keep the user engaged and inside the screen.
Built-in components can omit geometry and default to
`--width 40 --height 50 --x 60 --y 5`.
Custom components and `termos run -- <command>` require `--width --height --x --y` (0-100).
Use non-overlapping regions (percent-of-screen) and avoid bottom-left:
- Top-right: `--width 40 --height 45 --x 60 --y 5`
- Bottom-right: `--width 40 --height 45 --x 60 --y 55`
- Top-left: `--width 40 --height 45 --x 0 --y 5`

Before creating or editing custom interactive files, run:
```bash
termos run --help
```
Use it to review all built-in components and instructions. Verify and confirm the target file(s) before changing files.
