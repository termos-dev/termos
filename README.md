# Termos

Keep Claude Code interactive while it works.

**[termos-dev.github.io/termos](https://termos-dev.github.io/termos/)**

## Why Termos?

When Claude Code runs autonomously, you lose visibility and control. Termos lets Claude ask questions mid-run, show evidence (diffs, plans, test output) before proceeding, and keep you in sync without interrupting its flow.

- **Async questions** - Claude asks without blocking; you answer when ready
- **Proof while it runs** - Plans, diffs, and tests appear as evidence before the next step
- **Keep context** - Short check-ins prevent drift so you stay synced with the agent

## Installation

### Claude Code

```bash
npm install -g @termosdev/cli
claude plugins install termos
```

Then run `/termos:start` in Claude to start the session.

### Codex

**Repo-scoped (no install):** Add the skill to your repo:

```bash
mkdir -p .codex/skills
git clone https://github.com/termos-dev/termos.git .codex/skills/termos
```

**GitHub install (skill installer):**

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo termos-dev/termos \
  --path skills/termos \
  --ref main
```

Restart Codex after installing.

### Alternative: Manual Setup

If you prefer not to use the plugin system:

```bash
npm install -g @termosdev/cli
```

Then in your terminal:

```bash
# Start the event stream (keep running)
termos up

# In another terminal, Claude can run interactions
termos run confirm --prompt "Proceed with deployment?"
```

## How It Works

1. You start a Termos session with `/termos:start` (or `termos up` manually)
2. Claude triggers `termos run` to show interactive components (confirmations, checklists, diffs, etc.)
3. Your replies wake Claude immediately if waiting, or get injected into context when the run finishes

## Built-in Components

- `confirm` - Yes/no confirmations
- `ask` - Text input questions
- `checklist` - Multi-select options
- `code` - Syntax-highlighted code blocks
- `diff` - File diffs with syntax highlighting
- `table` - Data tables
- `markdown` - Rendered markdown
- `mermaid` - Diagrams
- `progress` - Progress indicators
- `plan-viewer` - Implementation plans
- `chart`, `gauge`, `json`, `select`, `tree` - And more

## Custom Components

Create `.tsx` files in `.termos/interactive/` for custom Ink components:

```tsx
import { Text, useInput, useApp } from 'ink';

declare const onComplete: (result: unknown) => void;

export default function() {
  const { exit } = useApp();
  useInput((_, key) => {
    if (key.return) { onComplete({ done: true }); exit(); }
  });
  return <Text>Press Enter to continue</Text>;
}
```

## Requirements

- **macOS**: Works natively, opens Ghostty or Terminal for interactions
- **Linux/Windows**: Requires [Zellij](https://zellij.dev/) for floating pane support

## License

MIT
