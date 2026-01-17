---
allowed-tools: Bash
forbidden-tools: AskUserQuestion
---

Start the Termos event stream (long-running). Use Zellij on Linux/Windows; on macOS this can run outside Zellij.

## Prerequisites

Check if installed:
```bash
which termos || echo "NOT_INSTALLED"
```

If NOT_INSTALLED, tell the user:
> Install with: `npm install -g @termosdev/cli`

## Read Project Preferences

Before using termos components, check for project preferences:

```bash
[ -f "termos.md" ] && cat termos.md
```

Follow the preferences defined there for interaction style, plan display, task tracking, and engagement.

## Start Session (REQUIRED)

On Linux/Windows, Termos must run inside a Zellij session.
On macOS, Termos can run without Zellij and will open Ghostty if available, otherwise Terminal tabs.

```bash
zellij attach --create <session-id>
termos up
```

`termos up` streams events and should be kept running as a background/base process (avoid shell `&`).

## Learn Available Components

Run `termos --help` to see all available components and project-specific instructions (from `termos.md`).

## Usage Guidance

**REQUIRED:** Run `termos run --help` before first use to learn component arguments.

Fire multiple `termos run` commands in parallel - don't wait after each one.
`--title` and `--position` are required for all invocations.

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

## Plan Mode & Task Tracking

Check the project's `termos.md` for preferences. If enabled:

### Plan Files
When entering plan mode, display the plan file in a pane:
```bash
termos run --title "Plan" --position floating:center plan-viewer --file /path/to/plan.md
```
The user can approve (Y) or reject (N) directly from the pane.

### Task Progress
For multi-step tasks, show live progress:
```bash
termos run --title "Tasks" --position floating:bottom-right progress --steps "Step1,Step2,Step3"
```
Update the current step as you complete each task.
