#!/bin/bash
# "Without Termos" Demo Recording Script
# Shows the blocking nature of traditional CLI questioning
# Non-interactive version for automated recording
#
# Usage: ./record-without-termos.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create demo script (non-interactive - simulates user typing)
cat > /tmp/without-termos-demo.sh << 'SCRIPT'
#!/bin/bash

# Function to simulate typing
type_slow() {
    local text="$1"
    for (( i=0; i<${#text}; i++ )); do
        echo -n "${text:$i:1}"
        sleep 0.08
    done
    echo ""
}

clear
sleep 0.5

echo "~/my-project $ claude"
sleep 0.8
echo "╭──────────────────────────────────────────────────────────────────╮"
echo "│  Claude Code v1.0.41                                             │"
echo "╰──────────────────────────────────────────────────────────────────╯"
echo ""
sleep 0.5

echo "> Help me refactor the authentication module"
echo ""
sleep 1

echo "⠋ Analyzing codebase..."
sleep 0.8
echo "✓ Found 12 files related to authentication"
echo ""
sleep 0.5

# First blocking question
echo "┌──────────────────────────────────────────────────────────────────┐"
echo "│ Question                                                         │"
echo "├──────────────────────────────────────────────────────────────────┤"
echo "│ Which authentication approach do you prefer?                     │"
echo "│                                                                  │"
echo "│   1) JWT with refresh tokens                                     │"
echo "│   2) Session-based authentication                                │"
echo "│   3) OAuth2 with external provider                               │"
echo "│                                                                  │"
echo "└──────────────────────────────────────────────────────────────────┘"
echo ""
echo "⏸  Claude is waiting for your answer..."
echo "   (Work blocked until you respond)"
echo ""
echo -n "Your choice (1-3): "
sleep 1.5
type_slow "1"
echo ""

echo "✓ Using JWT with refresh tokens"
echo ""
sleep 0.5

echo "⠋ Planning implementation..."
sleep 0.6
echo "✓ Plan ready"
echo ""
sleep 0.5

# Second blocking question
echo "┌──────────────────────────────────────────────────────────────────┐"
echo "│ Question                                                         │"
echo "├──────────────────────────────────────────────────────────────────┤"
echo "│ Should I add rate limiting to the auth endpoints?                │"
echo "│                                                                  │"
echo "│   1) Yes                                                         │"
echo "│   2) No                                                          │"
echo "│                                                                  │"
echo "└──────────────────────────────────────────────────────────────────┘"
echo ""
echo "⏸  Claude is waiting again..."
echo "   (Still blocked - no progress while waiting)"
echo ""
echo -n "Your choice (1-2): "
sleep 1.2
type_slow "1"
echo ""

echo "✓ Adding rate limiting"
echo ""
sleep 0.5

echo "⠋ Writing code..."
sleep 0.5
echo "✓ Created src/auth/jwt.ts"
echo "✓ Created src/auth/rateLimit.ts"
echo ""
sleep 0.5

# Third blocking question
echo "┌──────────────────────────────────────────────────────────────────┐"
echo "│ Question                                                         │"
echo "├──────────────────────────────────────────────────────────────────┤"
echo "│ Commit these changes?                                            │"
echo "│                                                                  │"
echo "│   y) Yes                                                         │"
echo "│   n) No                                                          │"
echo "│                                                                  │"
echo "└──────────────────────────────────────────────────────────────────┘"
echo ""
echo "⏸  Waiting for confirmation..."
echo ""
echo -n "Commit? (y/n): "
sleep 1
type_slow "y"
echo ""

echo "✓ Committed: feat(auth): implement JWT with rate limiting"
echo ""

echo "───────────────────────────────────────────────────────────────────"
echo ""
echo "  ⚠  Problem: Claude stops and waits for EVERY question."
echo "     Work is blocked until you respond."
echo "     Long tasks get interrupted repeatedly."
echo ""
echo "───────────────────────────────────────────────────────────────────"
echo ""

sleep 3
SCRIPT

chmod +x /tmp/without-termos-demo.sh

echo "Recording 'Without Termos' demo..."

# Record
asciinema rec \
    --overwrite \
    --cols 100 \
    --rows 30 \
    -c "/tmp/without-termos-demo.sh" \
    without-termos.cast

rm -f /tmp/without-termos-demo.sh

echo ""
echo "✓ Recording saved to: $SCRIPT_DIR/without-termos.cast"

# Convert to v2 format for compatibility
if command -v asciinema &> /dev/null; then
    echo "Converting to asciicast v2 format..."
    asciinema convert --output-format asciicast-v2 without-termos.cast without-termos.cast 2>/dev/null || true
fi
