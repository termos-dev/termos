#!/bin/bash
# Inject MIDE context at session start

# Get workspace from stdin JSON
INPUT=$(cat)
WORKSPACE=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -z "$WORKSPACE" ] && WORKSPACE=$(pwd)

# Check for mide.yaml
CONFIG_FILE=""
if [ -f "$WORKSPACE/mide.yaml" ]; then
  CONFIG_FILE="$WORKSPACE/mide.yaml"
elif [ -f "$WORKSPACE/mide.yml" ]; then
  CONFIG_FILE="$WORKSPACE/mide.yml"
fi

if [ -n "$CONFIG_FILE" ]; then
  PROJECT=$(basename "$WORKSPACE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')
  SESSION="mide-$PROJECT"

  # Check if tmux session exists
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "MIDE session: $SESSION (attach: mide connect)"
    echo ""

    # Extract process names, ports, and descriptions from mide.yaml
    # Format: process_name|port|description
    SERVICES=$(awk '
/^processes:/ { in_proc=1; next }
in_proc && /^  [a-zA-Z0-9_-]+:/ {
  if (proc != "" && port != "") print proc"|"port"|"desc
  proc = $0; sub(/:.*/, "", proc); sub(/^  /, "", proc)
  port = ""; desc = ""
}
in_proc && /^    port:/ { port = $0; sub(/^    port: */, "", port) }
in_proc && /^    description:/ { desc = $0; sub(/^    description: */, "", desc) }
END { if (proc != "" && port != "") print proc"|"port"|"desc }
    ' "$CONFIG_FILE")

    # Show Services section if any processes have ports
    if [ -n "$SERVICES" ]; then
      echo "Services:"
      echo "$SERVICES" | while IFS='|' read -r name port desc; do
        if [ -n "$desc" ]; then
          echo "  $name: http://localhost:$port - $desc"
        else
          echo "  $name: http://localhost:$port"
        fi
      done
      echo ""
    fi

    # Extract process names from mide.yaml (keys under 'processes:')
    # Skip empty lines, exit when hitting next top-level key
    PROC_NAMES=$(awk '/^processes:/{found=1; next} found && /^$/{next} found && /^[^ ]/{exit} found && /^  [a-zA-Z0-9_-]+:/{gsub(/:.*/, ""); gsub(/^  /, ""); print}' "$CONFIG_FILE")

    # Get pane count
    PANE_COUNT=$(tmux list-panes -t "$SESSION" -F "#{pane_index}" | wc -l | tr -d ' ')

    # Convert process names to array
    idx=0
    for PROC_NAME in $PROC_NAMES; do
      if [ $idx -ge $PANE_COUNT ]; then
        break
      fi

      # Capture last 2 non-empty lines from pane
      LAST_LINES=$(tmux capture-pane -t "$SESSION:0.$idx" -p 2>/dev/null | grep -v '^$' | tail -2)

      echo "[$PROC_NAME]"
      if [ -n "$LAST_LINES" ]; then
        echo "$LAST_LINES" | sed 's/^/  /'
      else
        echo "  (no output)"
      fi

      idx=$((idx + 1))
    done

    # List available ink files from both project and global locations
    PROJECT_INK_DIR="$WORKSPACE/.mide/interactive"
    GLOBAL_INK_DIR="$HOME/.mide/interactive"

    PROJECT_INK=""
    GLOBAL_INK=""

    if [ -d "$PROJECT_INK_DIR" ]; then
      PROJECT_INK=$(find "$PROJECT_INK_DIR" -maxdepth 1 \( -name "*.tsx" -o -name "*.jsx" \) -exec basename {} \; 2>/dev/null | sort)
    fi

    if [ -d "$GLOBAL_INK_DIR" ]; then
      GLOBAL_INK=$(find "$GLOBAL_INK_DIR" -maxdepth 1 \( -name "*.tsx" -o -name "*.jsx" \) -exec basename {} \; 2>/dev/null | sort)
    fi

    if [ -n "$PROJECT_INK" ] || [ -n "$GLOBAL_INK" ]; then
      echo ""
      echo "Available ink files (run with: "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" run <file>.tsx):"
      if [ -n "$PROJECT_INK" ]; then
        echo "  Project (.mide/interactive/):"
        echo "$PROJECT_INK" | sed 's/^/    /'
      fi
      if [ -n "$GLOBAL_INK" ]; then
        echo "  Global (~/.mide/interactive/):"
        echo "$GLOBAL_INK" | sed 's/^/    /'
      fi
    fi

    echo ""
    echo "Use /ide:start to manage services and create terminals."
  else
    echo "MIDE project detected but session not running."
    echo "Run /ide:start or '"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" connect' to start the session."

    # Still show ink files even if session not running
    PROJECT_INK_DIR="$WORKSPACE/.mide/interactive"
    GLOBAL_INK_DIR="$HOME/.mide/interactive"

    PROJECT_INK=""
    GLOBAL_INK=""

    if [ -d "$PROJECT_INK_DIR" ]; then
      PROJECT_INK=$(find "$PROJECT_INK_DIR" -maxdepth 1 \( -name "*.tsx" -o -name "*.jsx" \) -exec basename {} \; 2>/dev/null | sort)
    fi

    if [ -d "$GLOBAL_INK_DIR" ]; then
      GLOBAL_INK=$(find "$GLOBAL_INK_DIR" -maxdepth 1 \( -name "*.tsx" -o -name "*.jsx" \) -exec basename {} \; 2>/dev/null | sort)
    fi

    if [ -n "$PROJECT_INK" ] || [ -n "$GLOBAL_INK" ]; then
      echo ""
      echo "Available ink files (run with: "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/mide.sh" run <file>.tsx):"
      if [ -n "$PROJECT_INK" ]; then
        echo "  Project (.mide/interactive/):"
        echo "$PROJECT_INK" | sed 's/^/    /'
      fi
      if [ -n "$GLOBAL_INK" ]; then
        echo "  Global (~/.mide/interactive/):"
        echo "$GLOBAL_INK" | sed 's/^/    /'
      fi
    fi
  fi
fi
