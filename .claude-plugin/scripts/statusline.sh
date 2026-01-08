#!/bin/bash
# mcp-sidecar statusline script
# Shows tmux session name and process status for easy attach
#
# Only shows output if sidecar.yaml exists in the current directory

# Read stdin (Claude Code passes session context as JSON)
INPUT=$(cat)

# Get workspace directory from JSON input, fallback to pwd
if command -v jq &>/dev/null; then
  WORKSPACE_DIR=$(echo "$INPUT" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null)
fi
if [ -z "$WORKSPACE_DIR" ]; then
  WORKSPACE_DIR=$(pwd)
fi

# Check if sidecar.yaml exists in workspace directory
if [ ! -f "$WORKSPACE_DIR/sidecar.yaml" ] && [ ! -f "$WORKSPACE_DIR/sidecar.yml" ]; then
  echo ""
  exit 0
fi

# Get project name for session lookup
PROJECT_NAME=$(basename "$WORKSPACE_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')
SESSION_NAME="sidecar-${PROJECT_NAME}"

# Check if tmux session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  # Try with suffix
  SESSION_NAME=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^sidecar-${PROJECT_NAME}" | head -1)
  if [ -z "$SESSION_NAME" ]; then
    echo ""
    exit 0
  fi
fi

# ANSI colors
CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
GRAY='\033[90m'
RESET='\033[0m'

# Get process count from sidecar.yaml (only configured processes, not dynamic terminals)
CONFIG_FILE="$WORKSPACE_DIR/sidecar.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
  CONFIG_FILE="$WORKSPACE_DIR/sidecar.yml"
fi

# Count process entries in yaml (lines under "processes:" section with 2-space indent)
# This looks for lines like "  processname:" after "processes:"
PROCESS_COUNT=$(awk '/^processes:/{found=1; next} found && /^  [a-zA-Z0-9_-]+:/{count++} found && /^[^ ]/{exit} END{print count+0}' "$CONFIG_FILE" 2>/dev/null)

# Build status indicator - session exists means processes are managed
if [ "$PROCESS_COUNT" -gt 0 ]; then
  STATUS="${GREEN}${PROCESS_COUNT}✓${RESET}"
else
  STATUS="${GRAY}○${RESET}"
fi

# Output: [session-name] status
SHORT_SESSION=$(echo "$SESSION_NAME" | sed 's/^sidecar-//')
echo -e "${CYAN}[${SHORT_SESSION}]${RESET} ${STATUS}"
