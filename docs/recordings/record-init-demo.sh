#!/bin/bash
# Termos Init Wizard Demo Recording Script
# Shows the /termos:init experience
#
# Usage: ./record-init-demo.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create demo script - note we use printf for proper escape handling
cat > /tmp/init-demo.sh << 'SCRIPT'
#!/bin/bash

# Simulate typing
type_slow() {
    local text="$1"
    for (( i=0; i<${#text}; i++ )); do
        printf "%s" "${text:$i:1}"
        sleep 0.04
    done
}

clear
sleep 0.5

# Show claude prompt
printf "\033[0;90m~/my-project $\033[0m claude\n"
sleep 0.6

printf "\n"
printf "╭──────────────────────────────────────────────────────────────────╮\n"
printf "│  \033[1mClaude Code\033[0m v1.0.41                                            │\n"
printf "╰──────────────────────────────────────────────────────────────────╯\n"
printf "\n"
sleep 0.4

# User types command
printf "> "
type_slow "/termos:init"
printf "\n"
sleep 0.8

printf "\n"
printf "\033[0;36mDetecting environment...\033[0m\n"
sleep 0.4

printf "\n"
printf "  Platform: \033[0;32mmacOS\033[0m\n"
printf "  Zellij: \033[1;33mavailable\033[0m\n"
printf "  Ghostty: \033[0;32minstalled\033[0m\n"
printf "  Editors: nvim vim code cursor\n"
printf "\n"
sleep 0.8

printf "\033[0;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n"
printf "\n"
printf "  You're on macOS with Ghostty installed. Termos will open\n"
printf "  floating windows for interactions. For split panes,\n"
printf "  run inside Zellij: \033[0;90mzellij attach --create termos\033[0m\n"
printf "\n"
printf "\033[0;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n"
printf "\n"
sleep 1.2

# Question 1
printf "\033[1m? Preferred editor\033[0m\n"
printf "\n"
printf "  \033[0;32m❯ nvim\033[0m      \033[0;90m(Recommended) - in-pane editing enabled\033[0m\n"
printf "    vim       \033[0;90min-pane editing enabled\033[0m\n"
printf "    code      \033[0;90mopens files in VS Code\033[0m\n"
printf "    cursor    \033[0;90mopens files in Cursor\033[0m\n"
printf "\n"
sleep 1.5
printf "  \033[0;32m✓ Selected: nvim\033[0m\n"
printf "\n"
sleep 0.6

# Question 2
printf "\033[1m? Interaction style\033[0m\n"
printf "\n"
printf "  \033[0;32m❯ Balanced\033[0m  \033[0;90m(Recommended) - important decisions only\033[0m\n"
printf "    Proactive \033[0;90mshow everything\033[0m\n"
printf "    Minimal   \033[0;90monly when essential\033[0m\n"
printf "\n"
sleep 1.2
printf "  \033[0;32m✓ Selected: Balanced\033[0m\n"
printf "\n"
sleep 0.6

# Question 3 - multi-select
printf "\033[1m? Use cases\033[0m \033[0;90m(select multiple)\033[0m\n"
printf "\n"
printf "  \033[0;32m◉ Confirmations\033[0m    \033[0;90mbefore destructive actions\033[0m\n"
printf "  \033[0;32m◉ Progress\033[0m         \033[0;90mmulti-step operations\033[0m\n"
printf "  \033[0;32m◉ Code review\033[0m      \033[0;90mdiffs before commits\033[0m\n"
printf "  \033[0;90m◯ Data display\033[0m     \033[0;90mtables, charts, JSON\033[0m\n"
printf "  \033[0;90m◯ Always-on\033[0m        \033[0;90mpersistent widgets\033[0m\n"
printf "\n"
sleep 1.5
printf "  \033[0;32m✓ Selected: Confirmations, Progress, Code review\033[0m\n"
printf "\n"
sleep 0.6

# Question 4
printf "\033[1m? Show plans during plan mode?\033[0m\n"
printf "\n"
printf "  \033[0;32m❯ Yes\033[0m  \033[0;90m(Recommended) - display in floating pane\033[0m\n"
printf "    No   \033[0;90mkeep in editor only\033[0m\n"
printf "\n"
sleep 1
printf "  \033[0;32m✓ Selected: Yes\033[0m\n"
printf "\n"
sleep 0.5

# Creating file
printf "\033[0;36mCreating termos.md...\033[0m\n"
sleep 0.6
printf "\n"

printf "\033[0;32m┌──────────────────────────────────────────────────────────────────┐\033[0m\n"
printf "\033[0;32m│\033[0m  \033[1mtermos.md created\033[0m                                            \033[0;32m│\033[0m\n"
printf "\033[0;32m├──────────────────────────────────────────────────────────────────┤\033[0m\n"
printf "\033[0;32m│\033[0m                                                                  \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m  Editor: \033[0;36mnvim\033[0m (in-pane editing enabled)                        \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m  Style: \033[0;36mBalanced\033[0m                                               \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m                                                                  \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m  Enabled:                                                        \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m    \033[0;32m✓\033[0m Confirmations before destructive actions                 \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m    \033[0;32m✓\033[0m Progress tracking for multi-step tasks                   \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m    \033[0;32m✓\033[0m Code review with diff viewer                             \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m    \033[0;32m✓\033[0m Plan mode with floating viewer                           \033[0;32m│\033[0m\n"
printf "\033[0;32m│\033[0m                                                                  \033[0;32m│\033[0m\n"
printf "\033[0;32m└──────────────────────────────────────────────────────────────────┘\033[0m\n"
printf "\n"

sleep 1

printf "\033[0;32m✓\033[0m Ready! Claude will now use Termos for interactions.\n"
printf "\n"
printf "  Try: \033[0;90mtermos run confirm --prompt \"Test it out?\"\033[0m\n"
printf "\n"

sleep 3
SCRIPT

chmod +x /tmp/init-demo.sh

echo "Recording init wizard demo..."

# Record (v2 format for player compatibility)
asciinema rec \
    --overwrite \
    --cols 80 \
    --rows 40 \
    -f asciicast-v2 \
    -c "/tmp/init-demo.sh" \
    init-demo.cast

rm -f /tmp/init-demo.sh

echo ""
echo "✓ Recording saved to: $SCRIPT_DIR/init-demo.cast"
