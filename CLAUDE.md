# Claude IDE Project Instructions

## Auto-approve Termos Built-in Components

To allow Claude to run termos built-in components without permission prompts, add to your project's `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(termos *)"
    ]
  }
}
```

Custom `.tsx` files will still require permission. Add to `~/.claude/settings.json` for global settings.

## Local Development

For local development, use npm link:

```bash
cd /Users/burakemre/Code/ai-experiments/mcp-sidecar
npm run build
npm link
```

Then `termos` command is available globally.

## Zellij Requirement (Linux/Windows)

Run Termos **inside a Zellij session** on Linux/Windows:

```bash
zellij attach --create termos-dev
termos run --title "Test" confirm --prompt "Smoke test?"
termos wait <id>
```

## macOS Mode

On macOS you can run outside Zellij. Termos will open Ghostty if available,
otherwise it opens a Terminal tab for interactions:

```bash
termos run --title "Test" confirm --prompt "Smoke test?"
termos wait <id>
```

## Testing

When testing from different directories, clear the plugin cache first:
```bash
rm -rf ~/.claude/plugins/cache/termos
```

Then test with Claude Code:
```bash
cd /path/to/project
# Claude will use the updated plugin
```

## Termos Interactive Components

This project uses termos for interactive UI. Read `termos.md` for interaction preferences.

Workflow:
1. `termos run ...` spawns pane, returns interaction ID
2. `termos wait <id>` blocks until result (or run in background with `&`)
3. `termos result` checks all results, or `termos result <id>` for specific one

- **USE termos components** for confirmations, progress, and user engagement
- **Show plan files** in a pane during plan mode (if enabled in termos.md)
- **Display task progress** visually for multi-step operations

Run `termos --help` for available components. Always use `--title` and `--position` flags.
