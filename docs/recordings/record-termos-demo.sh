#!/bin/bash
# "Termos in Terminal" Demo Recording Script
# Shows async workflow with Termos (simulated for automated recording)
#
# Usage: ./record-termos-demo.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create demo script
cat > /tmp/termos-demo.sh << 'SCRIPT'
#!/bin/bash

# Simulate typing
type_slow() {
    local text="$1"
    for (( i=0; i<${#text}; i++ )); do
        echo -n "${text:$i:1}"
        sleep 0.05
    done
}

clear
sleep 0.5

echo "~/my-project $ claude"
sleep 0.8
echo "╭──────────────────────────────────────────────────────────────────╮"
echo "│  Claude Code v1.0.41  ● Termos connected                         │"
echo "╰──────────────────────────────────────────────────────────────────╯"
echo ""
sleep 0.5

echo "> Help me refactor the authentication module"
echo ""
sleep 1

echo "⠋ Analyzing codebase..."
sleep 0.6
echo "✓ Found 12 files related to authentication"
echo ""
sleep 0.4

echo "📋 Sending checklist to Termos..."
sleep 0.3
echo "✓ Checklist opened in separate pane"
echo ""
sleep 0.3

echo "⠋ Continuing analysis while you select..."
sleep 0.4
echo "✓ Identified deprecated patterns"
sleep 0.2
echo "✓ Found security improvements"
sleep 0.2
echo "✓ Located test coverage gaps"
echo ""

sleep 1.2
echo "◀ Termos: Received checklist response"
echo "  ☑ JWT with refresh tokens"
echo "  ☑ Add rate limiting"
echo "  ☐ OAuth2 integration"
echo ""
sleep 0.5

echo "⠋ Generating implementation plan..."
sleep 0.4
echo "✓ Plan ready"
echo ""

echo "📄 Sending plan to Termos for approval..."
sleep 0.2
echo "✓ Plan viewer opened"
echo ""
sleep 0.3

echo "⠋ Preparing code changes while you review..."
sleep 0.4
echo "✓ Code changes ready"
echo ""

sleep 1
echo "◀ Termos: Plan approved ✓"
echo ""
sleep 0.4

echo "⠋ Writing src/auth/jwt.ts..."
sleep 0.3
echo "✓ Created src/auth/jwt.ts"
sleep 0.2
echo "✓ Created src/auth/rateLimit.ts"
echo ""

echo "📊 Sending diff to Termos..."
sleep 0.2
echo "✓ Diff viewer opened"
echo ""
sleep 0.3

echo "⠋ Running tests while you review changes..."
sleep 0.4
echo "✓ Tests: 24 passed, 2 failed"
echo ""

sleep 1
echo "◀ Termos: Diff approved ✓"
echo ""
sleep 0.3

echo "📋 Sending test results table..."
sleep 0.2
echo "✓ Test results displayed"
echo ""

echo "⠋ Fixing failing tests..."
sleep 0.3
echo "✓ Fixed auth.test.ts"
sleep 0.2
echo "✓ All tests passing: 26 passed"
echo ""

echo "✅ Sending confirmation to Termos..."
sleep 0.2
echo "✓ Confirmation dialog opened"
echo ""

sleep 1
echo "◀ Termos: Commit confirmed ✓"
echo ""
sleep 0.3

echo "⠋ Creating commit..."
sleep 0.3
echo "✓ Committed: refactor(auth): implement JWT with rate limiting"
echo ""

echo "───────────────────────────────────────────────────────────────────"
echo ""
echo "  ✨ With Termos: Claude keeps working while you review."
echo "     • Checklist, plans, diffs open in separate panes"
echo "     • Responses stream back asynchronously"
echo "     • No blocking - continuous progress"
echo ""
echo "───────────────────────────────────────────────────────────────────"
echo ""

sleep 3
SCRIPT

chmod +x /tmp/termos-demo.sh

echo "Recording 'Termos in Terminal' demo..."

# Record
asciinema rec \
    --overwrite \
    --cols 100 \
    --rows 30 \
    -c "/tmp/termos-demo.sh" \
    termos-terminal.cast

rm -f /tmp/termos-demo.sh

echo ""
echo "✓ Recording saved to: $SCRIPT_DIR/termos-terminal.cast"

# Convert to v2 format
echo "Converting to asciicast v2 format..."
asciinema convert --output-format asciicast-v2 termos-terminal.cast termos-terminal-v2.cast 2>/dev/null && \
    mv termos-terminal-v2.cast termos-terminal.cast || true
