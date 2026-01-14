# termos

Interactive UI runner for Claude Code. Opens Ink-based components in Zellij floating panes and streams interaction results.

## Installation

```bash
npm install -g @termosdev/cli
```

## Claude Install

- Marketplace: install the Termos plugin from Claude’s plugin marketplace (if published).
- Local dev: run Claude with `--plugin-dir .claude-plugin` from this repo.

## Codex Skill Install

Use Codex’s skill tools:

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

- Zellij is required on Linux/Windows. On macOS, Termos can also run outside Zellij and will open
  new Terminal tabs for interactions.
- Pane geometry is required for custom components and commands when using Zellij. Built-ins default to
  width 40, height 50, x 60, y 5 (top-right) when omitted. Geometry is ignored in macOS Terminal mode.

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
termos run confirm --prompt "Proceed?"
```

Defaults for built-ins: `--width 40 --height 50 --x 60 --y 5`.

macOS Terminal mode (no Zellij):

```bash
termos up
termos run confirm --prompt "Proceed?"
```

If you run `termos up` and `termos run` from different directories, set a shared session name:

```bash
TERMOS_SESSION_NAME=my-session termos up
TERMOS_SESSION_NAME=my-session termos run confirm --prompt "Proceed?"
```

## CLI Commands

```bash
termos up                   # Stream events for current session (long-running)
termos run <component>       # Run a built-in or custom Ink component
termos run -- <command>      # Run a shell command in a floating pane
```

Built-in components: `ask`, `confirm`, `checklist`, `code`, `diff`, `table`, `progress`, `mermaid`, `markdown`, `plan-viewer`.

Run `termos run --help` for detailed schemas and options.

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
