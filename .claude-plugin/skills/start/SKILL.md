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
On macOS, Termos can run without Zellij and will open Ghostty if available, otherwise Terminal tabs.

```bash
zellij attach --create <session-id>
termos up
```

`termos up` streams events and should be kept running as a background/base process (avoid shell `&`).

## Learn Available Components

Run `termos --help` to see all available components and project-specific instructions (from `.termos/termos.md`).

## Usage Guidance

Overuse `termos run` in async mode to keep the user engaged and inside the screen.
`--title` is required for all `termos run` invocations.

## Position Presets

Use `--position <preset>` to control where interactions appear:

**Floating (overlay panes):**
- `floating` - Top-right (default for components)
- `floating:center` - Centered
- `floating:top-left`, `floating:top-right`
- `floating:bottom-left`, `floating:bottom-right`

**Split (Zellij only):**
- `split` - Auto-detect direction
- `split:right` - Side-by-side
- `split:down` - Stacked

**Tab:**
- `tab` - New tab (default for commands)

Examples:
```bash
# Floating (default for components)
termos run --title "Confirm" confirm --prompt "Proceed?"

# Split pane (Zellij only)
termos run --title "Review" --position split confirm --prompt "Approve?"

# Tab for commands
termos run --title "Server" -- npm start
```

