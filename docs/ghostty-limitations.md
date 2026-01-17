# Ghostty CLI Limitations

Reference document for Ghostty terminal emulator limitations relevant to termos.

## Summary

Ghostty does **not support programmatic tab/window creation via CLI**. This is a requested feature ([Discussion #3445](https://github.com/ghostty-org/ghostty/discussions/3445)) but not yet implemented.

## What Works

### Opening New Windows (with caveats)

```bash
open -na Ghostty --args --title="My Window" --working-directory="$(pwd)"
```

**Limitation**: Creates separate app instances, not tabs within the same window. Each becomes an independent process that doesn't close when the window closes.

### Configuration Options

| Option | Description | Platform |
|--------|-------------|----------|
| `title` | Set window title | All |
| `class` | WM_CLASS property | X11/GTK only |
| `macos-titlebar-style` | Titlebar appearance | macOS |
| `window-save-state` | Save/restore state | All |

### AppleScript Workaround (Limited)

```bash
osascript -e 'tell application "Ghostty" to activate' \
          -e 'tell application "System Events" to keystroke "t" using command down'
```

Opens a new tab in the existing window, but you lose control over the initial command/directory.

## What Doesn't Work

- **No IPC/socket interface** to control running instances
- **No `ghostty +new-tab`** CLI action
- **No window grouping API** for relating windows together
- **No way to open a tab** in an existing Ghostty window from CLI

## Implications for Termos

Given these limitations, termos uses:

1. **Zellij** on Linux/Windows - Full multiplexer with pane/tab control
2. **Terminal.app tabs** on macOS - Native AppleScript support for tab creation
3. **Ghostty fallback** on macOS - Opens separate window when Ghostty is available but without proper tab grouping

## Future

Watch [Discussion #3445](https://github.com/ghostty-org/ghostty/discussions/3445) for updates on programmatic tab/window creation.

## References

- [Ghostty Config Reference](https://ghostty.org/docs/config/reference)
- [Create new tab/window via CLI - Discussion #3445](https://github.com/ghostty-org/ghostty/discussions/3445)
- [Launch new window on macOS - Discussion #9221](https://github.com/ghostty-org/ghostty/discussions/9221)
- [Possibility to start a new tab - Discussion #4579](https://github.com/ghostty-org/ghostty/discussions/4579)
