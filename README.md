# termos

Interactive UI runner for Claude Code. Opens Ink-based components in Zellij floating panes and streams interaction results.

## Installation

```bash
npm install -g @termosdev/cli
```

## Claude Install

- Marketplace: install the Termos plugin from Claude's plugin marketplace (if published).
- Local dev: run Claude with `--plugin-dir .claude-plugin` from this repo.

## Codex Skill Install

Use Codex's skill tools:

- Repo‑scoped (no install): put the skill in `.codex/skills/termos` inside your repo.
  ```bash
  mkdir -p .codex/skills
  ln -s ../../skills/termos .codex/skills/termos
  ```
- GitHub install (skill installer):
  ```bash
  python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
    --repo <owner>/<repo> \
    --path skills/termos \
    --ref main
  ```

Restart Codex after installing.

## Requirements

- Zellij is required on Linux/Windows. On macOS, Termos can run outside Zellij and will open
  Ghostty if available; otherwise it opens macOS Terminal tabs for interactions.

## Quick Start

1. Start or attach to a Zellij session (recommended):

```bash
zellij attach --create my-session
```

2. Start the Termos event stream (keep this running):

```bash
termos up
```

`termos up` streams interaction results.

3. Run an interaction (in another pane/tab):

```bash
termos run --title "Confirm" confirm --prompt "Proceed?"
```

macOS mode (no Zellij):

```bash
termos up
termos run --title "Confirm" confirm --prompt "Proceed?"
```

If you run `termos up` and `termos run` from different directories, set a shared session name:

```bash
# Linux/Windows or cross-directory usage:
TERMOS_SESSION_NAME=my-session termos up
TERMOS_SESSION_NAME=my-session termos run --title "Confirm" confirm --prompt "Proceed?"
```

Note: On macOS, the session name is automatically generated from the directory name, so `--session` is only needed when running from different directories.

## CLI Commands

```bash
termos up                   # Stream events for current session (long-running)
termos run <component>       # Run a built-in or custom Ink component
termos run -- <command>      # Run a shell command (tab by default)
```

Built-in components: `ask`, `confirm`, `checklist`, `code`, `diff`, `table`, `progress`, `mermaid`, `markdown`, `plan-viewer`.

Run `termos run --help` for detailed schemas and options.

## Position Presets

Use `--position <preset>` to control where interactions appear:

**Floating (overlay panes):**
- `floating` - Top-right (default for components)
- `floating:center` - Centered overlay
- `floating:top-left`, `floating:top-right`
- `floating:bottom-left`, `floating:bottom-right`

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

## Interactive Forms

Show forms to collect user input:

```typescript
show_user_interaction({
  schema: {
    questions: [
      { question: "Project name?", header: "Name", inputType: "text" },
      { question: "Language?", header: "Lang", options: [
        { label: "TypeScript" },
        { label: "Python" }
      ]}
    ]
  }
})
```

## Custom Ink Components

Create `.tsx` files in `.termos/interactive/`:

```tsx
import { Text, useInput, useApp } from 'ink';

declare const onComplete: (result: unknown) => void;

export default function() {
  const { exit } = useApp();
  useInput((_, key) => {
    if (key.return) { onComplete({ done: true }); exit(); }
  });
  return <Text>Press Enter</Text>;
}
```

Run with: `show_user_interaction({ ink_file: "my-component.tsx" })`

## License

MIT
