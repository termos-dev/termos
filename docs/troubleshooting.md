# Troubleshooting

## Quick facts

- Zellij only: floating panes show only inside a Zellij session.
- macOS without Zellij: Termos opens Ghostty (if installed) or a Terminal tab.
- Sessions: results are written to `~/.termos/sessions/<session>/events.jsonl`.
- tmux is not supported.

## Session confusion ("termos up shows nothing")

On macOS, the session name is auto-generated from the directory name, so `--session` is optional:

```bash
# On macOS: session auto-generated from directory name
termos up
termos run --title "Confirm" confirm --prompt "Proceed?"
```

On Linux/Windows outside Zellij, you must use a shared session name:

```bash
termos up --session demo
termos run --session demo --title "Confirm" confirm --prompt "Proceed?"
```

Or set `TERMOS_SESSION_NAME` for both commands.

Inside Zellij, the session name is always `ZELLIJ_SESSION_NAME` and `--session` is ignored:

```bash
echo $ZELLIJ_SESSION_NAME
```

## Floating pane opens then closes

This usually means the floating pane process exits immediately (often `node` not found in the pane PATH).

Run this inside Zellij to verify PATH in floating panes:

```bash
zellij run --floating -- $SHELL -lc 'echo node=$(command -v node); node -v; read -n 1'
```

If `node` is missing, force the Node binary used by Termos:

```bash
TERMOS_NODE="$(command -v node)" termos run --wait --title "Confirm" confirm --prompt "Ping?"
```

## Commands in Zellij (tab vs floating vs split)

`termos run -- <command>` opens a new Zellij tab by default. Use `--position` to control placement:

```bash
# Tab (default for commands)
termos run --title "HTTP Server" -- python3 -m http.server 8000

# Floating pane
termos run --title "HTTP Server" --position floating -- python3 -m http.server 8000

# Split pane (integrated into layout)
termos run --title "HTTP Server" --position split -- python3 -m http.server 8000
```

## `--wait` hangs

`--wait` only returns after the popup completes and a result is written to the events file.

Check the events file directly:

```bash
tail -f ~/.termos/sessions/<session>/events.jsonl
```

If it stays empty after you answer, the pane didn’t write results (see PATH note above).

## Verify a session stream manually

```bash
# write a fake event
printf '{"ts":%s,"type":"result","id":"test","action":"accept"}\n' "$(date +%s000)" >> ~/.termos/sessions/<session>/events.jsonl
```

If `termos up` is attached to the right session, it should print the line immediately.

## Confirm you are using the local build

If you expect local changes but `termos` behaves like an old version:

```bash
which termos
termos --help
```

The repo ships a wrapper at `.claude-plugin/scripts/termos` that uses `dist/index.js` when present.

## macOS Ghostty notes

- Ghostty is used if installed; otherwise a Terminal tab is opened.
- Split positions (`--position split`) fall back to a new window outside Zellij.
