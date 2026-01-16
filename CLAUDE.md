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
termos up
termos run confirm --prompt "Smoke test?"
```
`termos up` streams events and should be kept running in a separate pane to receive interaction results.

## macOS Mode

On macOS you can run outside Zellij. Termos will open Ghostty if available,
otherwise it opens a Terminal tab for interactions:

```bash
termos up
termos run confirm --prompt "Smoke test?"
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
