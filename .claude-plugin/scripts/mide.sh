#!/bin/bash
# Wrapper script for mide CLI
# Uses local build in development, falls back to npx for installed plugin

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DIST="${SCRIPT_DIR}/../../dist/index.js"

if [ -f "$LOCAL_DIST" ]; then
    node "$LOCAL_DIST" "$@"
else
    npx mcp-ide "$@"
fi

# After connect command, tell user how to view the session
if [ "$1" = "connect" ]; then
    SESSION_NAME="mide-$(basename "$PWD")"
    echo ""
    if [ -n "$TMUX" ]; then
        echo "[mide] Session attached in a split pane - you should see it in your terminal."
    else
        echo "[mide] To view the session, run: mide connect"
    fi
fi
