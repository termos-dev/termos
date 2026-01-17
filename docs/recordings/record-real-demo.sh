#!/bin/bash
# Real Termos Demo - Shows Claude + Termos interaction
# Demonstrates how termos pops up while Claude is working

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cat > /tmp/real-demo.sh << 'SCRIPT'
#!/bin/bash

clear
sleep 0.3

# ============================================
# Claude is running
# ============================================
printf "\033[0;90m~/my-project $\033[0m claude\n"
sleep 0.5
printf "\n"
printf "╭─────────────────────────────────────────────────────────────────╮\n"
printf "│  \033[1mClaude Code\033[0m                                                   │\n"
printf "╰─────────────────────────────────────────────────────────────────╯\n"
printf "\n"
sleep 0.3

printf "> Help me deploy this app to production\n"
printf "\n"
sleep 0.8

printf "\033[36m⠋\033[0m Analyzing deployment configuration...\n"
sleep 0.5
printf "\033[32m✓\033[0m Found Dockerfile and docker-compose.yml\n"
sleep 0.3
printf "\033[32m✓\033[0m Detected staging and production environments\n"
sleep 0.3
printf "\n"

printf "\033[36m⠙\033[0m Building application...\n"
sleep 0.6
printf "\033[32m✓\033[0m Build complete (2.3s)\n"
sleep 0.3
printf "\033[32m✓\033[0m Tests passing (24/24)\n"
printf "\n"
sleep 0.5

# Termos pops up
printf "\033[1;33m◀ Termos:\033[0m Opening confirmation...\n"
sleep 0.3
printf "\n"
printf "┌─────────────────────────────────────────────────────────────────┐\n"
printf "│                                                                 │\n"
printf "│  \033[1;36mDeploy to production?\033[0m                                        │\n"
printf "│                                                                 │\n"
printf "│  This will deploy commit \033[33mab3f2c1\033[0m to prod.example.com          │\n"
printf "│                                                                 │\n"
printf "│  \033[7;32m Yes \033[0m   No                                                   │\n"
printf "│                                                                 │\n"
printf "│  \033[2my/n = quick select\033[0m                                            │\n"
printf "│                                                                 │\n"
printf "└─────────────────────────────────────────────────────────────────┘\n"
printf "\n"

sleep 2

# User confirms
printf "\033[1;32m◀ Termos:\033[0m User confirmed: \033[32mYes\033[0m\n"
printf "\n"
sleep 0.5

printf "\033[36m⠹\033[0m Deploying to production...\n"
sleep 0.4

# Progress popup
printf "\n"
printf "\033[1;33m◀ Termos:\033[0m Showing progress...\n"
sleep 0.2
printf "\n"
printf "┌─────────────────────────────────────────────────────────────────┐\n"
printf "│  \033[1;36mDeployment Progress\033[0m                                          │\n"
printf "│                                                                 │\n"
printf "│  \033[32m████████████████████\033[0m 100%%                                   │\n"
printf "│                                                                 │\n"
printf "│  \033[32m✓\033[0m Build application                                          │\n"
printf "│  \033[32m✓\033[0m Run tests                                                  │\n"
printf "│  \033[32m✓\033[0m Push to registry                                           │\n"
printf "│  \033[32m✓\033[0m Deploy to production                                       │\n"
printf "│                                                                 │\n"
printf "│  \033[1;32mComplete!\033[0m                                                    │\n"
printf "└─────────────────────────────────────────────────────────────────┘\n"
printf "\n"

sleep 1.5

printf "\033[32m✓\033[0m Deployed to \033[4mhttps://prod.example.com\033[0m\n"
printf "\n"

sleep 0.5

printf "───────────────────────────────────────────────────────────────────\n"
printf "\n"
printf "  \033[1mAutonomous, not absent.\033[0m\n"
printf "  \033[2mClaude works. You stay in control.\033[0m\n"
printf "\n"
printf "───────────────────────────────────────────────────────────────────\n"

sleep 3
SCRIPT

chmod +x /tmp/real-demo.sh

echo "Recording Claude + Termos demo..."

# Record (v2 format for player compatibility)
asciinema rec \
    --overwrite \
    --cols 72 \
    --rows 32 \
    -f asciicast-v2 \
    -c "/tmp/real-demo.sh" \
    hero-demo.cast

rm -f /tmp/real-demo.sh

echo ""
echo "✓ Recording saved to: $SCRIPT_DIR/hero-demo.cast"
