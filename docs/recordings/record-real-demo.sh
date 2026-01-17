#!/bin/bash
# Termos Demo - Accurate simulation of Claude + Termos
# Shows real component visuals as they appear to users

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cat > /tmp/real-demo.sh << 'SCRIPT'
#!/bin/bash

clear
sleep 0.3

# ============================================
# Claude Code CLI running
# ============================================
printf "\033[0;90m~/my-project $\033[0m claude \"deploy this to production\"\n"
sleep 0.6

printf "\n"
printf "╭─────────────────────────────────────────────────────────────╮\n"
printf "│  \033[1mClaude Code\033[0m                                               │\n"
printf "╰─────────────────────────────────────────────────────────────╯\n"
printf "\n"
sleep 0.4

printf "\033[36m⠋\033[0m Analyzing project...\n"
sleep 0.4
printf "\033[32m✓\033[0m Found deployment config\n"
sleep 0.3
printf "\033[32m✓\033[0m Build successful\n"
printf "\n"
sleep 0.4

# Claude triggers termos
printf "\033[2m$ termos run confirm --prompt \"Deploy to production?\"\033[0m\n"
sleep 0.3

# Show the REAL confirm component UI (as it actually renders)
printf "\n"
printf " \033[1;36mDeploy to production?\033[0m\n"
printf "\n"
printf " \033[7;32m Yes \033[0m  No \n"
printf "\n"
printf " \033[2my/n=quick  ←→=switch  Enter=confirm\033[0m\n"

sleep 1.8

# User presses Y
printf "\033[5A"  # Move up
printf " \033[1;36mDeploy to production?\033[0m\n"
printf "\n"
printf " \033[1;32m✓ Confirmed\033[0m\n"
printf "\n"
printf "                                        \n"
sleep 0.5

printf "\n"
printf "\033[36m⠙\033[0m Deploying...\n"
sleep 0.3

# Claude triggers progress
printf "\033[2m$ termos run progress --steps \"Build,Test,Push,Deploy\"\033[0m\n"
sleep 0.2

# Show REAL progress component
printf "\n"
printf " \033[1;36mDeployment\033[0m\033[2m (2/4)\033[0m\n"
printf "\n"
printf " \033[32m██████████\033[0m\033[2m░░░░░░░░░░\033[0m 50%%\n"
printf "\n"
printf " \033[32m✓\033[0m Build\n"
printf " \033[32m✓\033[0m Test\n"
printf " \033[36m⠋\033[0m Push to registry\n"
printf " \033[2m○ Deploy\033[0m\n"

sleep 0.8

# Animate to completion
printf "\033[6A"
printf " \033[1;36mDeployment\033[0m\033[2m (4/4)\033[0m\n"
printf "\n"
printf " \033[32m████████████████████\033[0m 100%%\n"
printf "\n"
printf " \033[32m✓\033[0m Build\n"
printf " \033[32m✓\033[0m Test\n"
printf " \033[32m✓\033[0m Push to registry\n"
printf " \033[32m✓\033[0m Deploy\n"

sleep 1

printf "\n"
printf "\033[32m✓\033[0m Deployed to \033[4mhttps://prod.example.com\033[0m\n"
printf "\n"
sleep 0.5

printf "─────────────────────────────────────────────────────────────────\n"
printf "  \033[1mAutonomous, not absent.\033[0m\n"
printf "─────────────────────────────────────────────────────────────────\n"

sleep 3
SCRIPT

chmod +x /tmp/real-demo.sh

echo "Recording demo..."

asciinema rec \
    --overwrite \
    --cols 68 \
    --rows 28 \
    -f asciicast-v2 \
    -c "/tmp/real-demo.sh" \
    hero-demo.cast

rm -f /tmp/real-demo.sh

echo "✓ Recording saved to: $SCRIPT_DIR/hero-demo.cast"
