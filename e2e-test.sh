#!/bin/bash
set -e

# E2E Test Script for Termos
# Automatically uses Zellij (creates session if needed) or runs in Docker

USE_DOCKER=false
TEST_PATH="."
SESSION_NAME="termos-e2e"
PROMPT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --docker)
      USE_DOCKER=true
      shift
      ;;
    --path)
      TEST_PATH="$2"
      shift 2
      ;;
    --session|-s)
      SESSION_NAME="$2"
      shift 2
      ;;
    --prompt|-p)
      PROMPT="$2"
      shift 2
      ;;
    *)
      # Treat as prompt if not a flag
      if [[ ! "$1" =~ ^-- ]]; then
        PROMPT="$1"
      fi
      shift
      ;;
  esac
done

# Check if we're inside Zellij
in_zellij() {
  [ -n "$ZELLIJ_SESSION_NAME" ]
}

# Dismiss Zellij welcome/onboarding screens
dismiss_zellij_welcome() {
  for i in {1..20}; do
    zellij action dump-screen /tmp/zellij-screen.txt 2>/dev/null || true
    if grep -qE "Welcome to Zellij|Release Notes" /tmp/zellij-screen.txt 2>/dev/null; then
      zellij action write-chars $'\e' 2>/dev/null || true
      sleep 0.3
      continue
    fi
    if grep -q "Choose the text style" /tmp/zellij-screen.txt 2>/dev/null; then
      zellij action write-chars '1' 2>/dev/null || true
      zellij action write-chars $'\r' 2>/dev/null || true
      sleep 0.3
      continue
    fi
    break
  done
  rm -f /tmp/zellij-screen.txt
}

# Wait for Claude to be ready and dismiss first-run screens
wait_for_claude() {
  echo "Waiting for Claude to be ready..."
  for i in {1..60}; do
    zellij action dump-screen /tmp/claude-screen.txt 2>/dev/null || true

    # Dismiss first-run screens
    if grep -qE "Security notes|Press .*Enter.*to continue" /tmp/claude-screen.txt 2>/dev/null; then
      zellij action write-chars $'\r' 2>/dev/null || true
      sleep 0.3
      continue
    fi
    if grep -qE "Ready to code|permission to work|Yes, continue" /tmp/claude-screen.txt 2>/dev/null; then
      zellij action write-chars '1' 2>/dev/null || true
      zellij action write-chars $'\r' 2>/dev/null || true
      sleep 0.3
      continue
    fi
    if grep -qE "Choose the text style|Welcome to Claude" /tmp/claude-screen.txt 2>/dev/null; then
      zellij action write-chars '1' 2>/dev/null || true
      zellij action write-chars $'\r' 2>/dev/null || true
      sleep 0.3
      continue
    fi

    # Check if Claude is ready
    if grep -qE "^> |^› |^❯ |Recent activity|Welcome back|Claude Code" /tmp/claude-screen.txt 2>/dev/null; then
      rm -f /tmp/claude-screen.txt
      echo "Claude is ready."
      return 0
    fi
    sleep 0.5
  done
  rm -f /tmp/claude-screen.txt
  echo "Warning: Claude prompt not detected, continuing anyway..."
  return 0
}

# Verify floating pane appeared in layout (only works when run FROM WITHIN Zellij)
verify_pane_in_layout() {
  local pane_name="$1"
  # Only verify if we're actually inside a Zellij client (not just session name set)
  if [ -z "$ZELLIJ" ]; then
    # Outside Zellij client - can't verify layout, just return success
    return 0
  fi
  sleep 1
  layout=$(timeout 3 zellij action dump-layout 2>/dev/null || true)
  if echo "$layout" | grep -q "name=\"$pane_name\""; then
    return 0
  fi
  return 1
}

# Run tests (called from within Zellij or native mode)
run_tests() {
  echo ""
  echo "Running Termos E2E Tests..."
  if [ -n "$ZELLIJ" ]; then
    echo "Mode: Zellij (with layout verification)"
  else
    echo "Mode: Native/Ghostty (output verification only)"
  fi
  echo "=========================================="

  local failed=0
  local passed=0
  local verify_msg=""
  [ -n "$ZELLIJ" ] && verify_msg=" + layout verified" || verify_msg=""

  echo -n "Test 1: --cmd execution... "
  result=$(termos run --title "E2E-CMD" --cmd "echo hello" 2>&1)
  if echo "$result" | grep -q '"status":"started"' && verify_pane_in_layout "E2E-CMD"; then
    echo "✓ PASS${verify_msg}"
    ((passed++))
  else
    echo "✗ FAIL"
    ((failed++))
  fi

  echo -n "Test 2: confirm component... "
  result=$(termos run confirm --title "E2E-Confirm" --prompt "Test?" 2>&1)
  if echo "$result" | grep -q '"status":"started"' && verify_pane_in_layout "E2E-Confirm"; then
    echo "✓ PASS${verify_msg}"
    ((passed++))
  else
    echo "✗ FAIL"
    ((failed++))
  fi

  echo -n "Test 3: checklist component... "
  result=$(termos run checklist --title "E2E-Checklist" --items '["A","B"]' 2>&1)
  if echo "$result" | grep -q '"status":"started"' && verify_pane_in_layout "E2E-Checklist"; then
    echo "✓ PASS${verify_msg}"
    ((passed++))
  else
    echo "✗ FAIL"
    ((failed++))
  fi

  echo -n "Test 4: table component... "
  result=$(termos run table --title "E2E-Table" --data '[{"x":1}]' 2>&1)
  if echo "$result" | grep -q '"status":"started"' && verify_pane_in_layout "E2E-Table"; then
    echo "✓ PASS${verify_msg}"
    ((passed++))
  else
    echo "✗ FAIL"
    ((failed++))
  fi

  echo -n "Test 5: progress component... "
  result=$(termos run progress --title "E2E-Progress" --steps '["Step 1"]' 2>&1)
  if echo "$result" | grep -q '"status":"started"' && verify_pane_in_layout "E2E-Progress"; then
    echo "✓ PASS${verify_msg}"
    ((passed++))
  else
    echo "✗ FAIL"
    ((failed++))
  fi

  echo -n "Test 6: code component... "
  result=$(termos run code --title "E2E-Code" --file package.json 2>&1)
  if echo "$result" | grep -q '"status":"started"' && verify_pane_in_layout "E2E-Code"; then
    echo "✓ PASS${verify_msg}"
    ((passed++))
  else
    echo "✗ FAIL"
    ((failed++))
  fi

  echo ""
  echo "=========================================="
  echo "Results: $passed passed, $failed failed"
  [ -z "$ZELLIJ" ] && echo "Note: Run inside Zellij for full layout verification"
  echo "=========================================="

  [ "$failed" -eq 0 ]
}

#######################################
# DOCKER MODE
#######################################
if [ "$USE_DOCKER" = true ]; then
  echo "Setting up Docker environment..."

  docker build -f Dockerfile.test -t termos-test . >/dev/null 2>&1
  docker rm -f termos-test 2>/dev/null || true
  docker run -d -v "$(pwd)":/workspace -w /workspace --name termos-test termos-test sleep infinity >/dev/null

  echo "Installing dependencies..."
  docker exec termos-test bash -c 'npm install --silent && npm run build --silent && npm link --silent' 2>&1 | tail -1

  # Run tests via Zellij inside Docker
  docker exec -it termos-test bash -c "
    zellij attach --create $SESSION_NAME &
    sleep 2
    export ZELLIJ_SESSION_NAME=$SESSION_NAME
    # Run tests here
  "

  echo ""
  echo "Cleanup: docker rm -f termos-test"
  exit 0
fi

#######################################
# LOCAL MODE
#######################################
cd "$TEST_PATH"

# Build termos if needed
if ! command -v termos >/dev/null 2>&1; then
  echo "Building termos..."
  npm run build --silent 2>&1 | tail -1
  npm link --silent 2>&1 | tail -1
fi

# If already in Zellij, just run tests
if in_zellij; then
  echo "Already in Zellij session: $ZELLIJ_SESSION_NAME"
  run_tests
  exit $?
fi

# Check if we have a TTY (interactive terminal)
if [ -t 0 ] && [ -t 1 ]; then
  # Interactive terminal - create Zellij session and attach
  echo "Creating Zellij session: $SESSION_NAME"
  echo "=========================================="

  # Check if session already exists
  if zellij list-sessions 2>/dev/null | grep -q "$SESSION_NAME"; then
    echo "Session '$SESSION_NAME' exists, attaching..."
    exec zellij attach "$SESSION_NAME"
  fi

  # Create new session in background
  zellij --session "$SESSION_NAME" --new-session-with-layout default &
  ZELLIJ_PID=$!
  sleep 2

  # Wait for session to be ready
  for i in {1..20}; do
    if zellij list-sessions 2>/dev/null | grep -q "$SESSION_NAME"; then
      break
    fi
    sleep 0.5
  done

  export ZELLIJ_SESSION_NAME="$SESSION_NAME"

  # Dismiss welcome screens
  dismiss_zellij_welcome

  # Start Claude in the main pane
  echo "Starting Claude..."
  zellij action write-chars "claude --dangerously-skip-permissions"
  zellij action write-chars $'\n'

  # Wait for Claude to be ready
  wait_for_claude

  # Inject prompt if provided
  if [ -n "$PROMPT" ]; then
    echo "Injecting prompt..."
    zellij action write-chars "$PROMPT"
    zellij action write-chars $'\n'
  fi

  echo ""
  echo "=========================================="
  echo "Zellij session '$SESSION_NAME' is ready!"
  echo ""
  echo "To attach: zellij attach $SESSION_NAME"
  echo "To kill:   zellij kill-session $SESSION_NAME"
  echo "=========================================="

  # Attach to the session
  exec zellij attach "$SESSION_NAME"
else
  # Non-interactive (e.g., CI, Claude) - run tests in native mode (Ghostty/Terminal)
  echo "Non-interactive mode detected - running tests in native mode"
  run_tests
  exit $?
fi
