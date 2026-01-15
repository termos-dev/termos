---
allowed-tools: Bash
---

Start the Termos event stream (long-running). Use Zellij on Linux/Windows; on macOS this can run outside Zellij.

```bash
termos up
```

Run this as a background/base process so it stays alive (do not use shell `&`).

Keep this process running in a separate pane/tab or background job to receive interaction results. `termos run --title "<text>" <component>` will display interactive UIs in a floating pane (Zellij) or a macOS Terminal tab.
