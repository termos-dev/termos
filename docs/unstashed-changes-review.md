# Unstashed Changes Review

Date: 2026-01-10
Scope: Review of current unstashed changes for gotchas and dead code.

## Dead Code / Unused Exports

- `TmuxManager.getPaneId()` is defined but not referenced anywhere.
  - `src/tmux-manager.ts:426` and `src/tmux-manager.ts:538`
- `TmuxManager.getWindowPaneId()` is defined but not referenced anywhere.
  - `src/tmux-manager.ts:572`
- Dashboard layout helpers in tmux manager appear unused by the new flow:
  - `createDashboardLayout()` and `recreateDashboardLayout()` are not called.
  - `src/tmux-manager.ts:1472` and `src/tmux-manager.ts:1626`
- Config helpers are exported but unused:
  - `getLayoutTabs()` and `getServiceTabs()`
  - `src/config.ts:414` and `src/config.ts:424`
- Interaction state `mode` is written but never read.
  - `src/interaction-manager.ts:224`, `src/interaction-manager.ts:270`

## Issues / Gotchas Identified

### 1) `respawn-pane` likely broken (critical)
`respawn-pane` is called with a full shell command string (e.g., `cd ... && ...`) but without `sh -c`, so tmux treats it as a single binary name. This will fail for most commands. The fallback `sendKeys` does not revive dead panes, so restarts and welcome respawns break.

- Affected code:
  - `src/tmux-manager.ts:1288` (`respawnPane`)
  - Callers: `src/process.ts:1060`, `src/process-manager.ts:342`

### 2) Existing sessions report 0 tabs (high)
`loadProcesses()` does not rebuild `tabIndices`, so `listTabs()` and `mcp-ide up` status are empty or misleading for already-running sessions.

- `src/process-manager.ts:118` (`listTabs`)
- `src/process-manager.ts:146` (`loadProcesses`)
- `src/index.ts:796` (status formatting)

### 3) `run_interaction` command mode never completes unless protocol output is emitted (high)
For `mcp-ide run --wait -- <command>`, there is no completion signal unless the command writes the result file or prints `__MCP_RESULT__`. This can hang until timeout.

- `src/interaction-manager.ts:215` (`create` runner selection)
- `src/interaction-manager.ts:444` (result detection)
- CLI wiring: `src/index.ts:69`

### 4) Hot-reload always kills all tabs on any JSON diff (medium)
`tabsEqual()` uses `JSON.stringify`, so reordering keys or non-semantic edits will trigger a full teardown of windows 1+ and restart tabs. Also, `autoStart: false` services won’t be restarted after reload.

- `src/process-manager.ts:625`
- `src/config.ts:405`

### 5) File watcher only listens to `change` (medium)
Some editors save via atomic rename (write+rename), which can emit `rename` events and skip reload.

- `src/file-watcher.ts:21`

### 6) Legacy configs no longer valid (medium)
Config now requires `tabs` and rejects legacy `services/processes/layout` keys, which is a breaking change unless migration is explicitly documented.

- `src/config.ts:200`

### 7) Split direction default mismatch (low)
The docstring says default split is “right”, but schema default is `auto`.

- `src/config.ts:184`

## Notes
- This file is a review artifact; it does not modify code.
- If you want, I can propose fixes or open PR-ready patches for the high/critical items.
