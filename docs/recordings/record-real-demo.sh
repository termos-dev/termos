#!/bin/bash
# Real Termos Component Demo - Accurate visual reproduction
# Shows what users actually see in termos panes

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cat > /tmp/real-demo.sh << 'SCRIPT'
#!/bin/bash

clear
sleep 0.3

# ============================================
# DEMO 1: Confirm Component
# ============================================
printf "\n"
printf " \033[1;36mDeploy to production?\033[0m\n"
printf "\n"
printf " \033[7;32m Yes \033[0m  \033[0m No \033[0m\n"
printf "\n"
printf " \033[2my/n=quick select  ←→=switch  Enter=confirm  Esc=cancel\033[0m\n"

sleep 2

# Show user pressing Y
printf "\033[A\033[A\033[A"  # Move up
printf "\r \033[1;36mDeploy to production?\033[0m\n"
printf "\n"
printf " \033[1;32m✓ Yes\033[0m\n"
printf "\n"
printf " \033[2mConfirmed\033[0m\n"

sleep 1.5
clear

# ============================================
# DEMO 2: Progress Component
# ============================================
printf "\n"
printf " \033[1;36mDeployment\033[0m\033[2m (1/4)\033[0m\n"
printf "\n"
printf " \033[32m█████\033[0m\033[2m░░░░░░░░░░░░░░░\033[0m 25%%\n"
printf "\n"
printf " \033[32m✓\033[0m Build application\n"
printf " \033[36m⠋\033[0m Run tests\n"
printf " \033[2m○ Deploy to staging\033[0m\n"
printf " \033[2m○ Deploy to production\033[0m\n"
printf "\n"
printf " \033[2mq=cancel\033[0m\n"

sleep 1

# Animate progress
for step in 2 3 4; do
    sleep 0.8
    case $step in
        2)
            printf "\033[8A"  # Move up
            printf " \033[1;36mDeployment\033[0m\033[2m (2/4)\033[0m\n"
            printf "\n"
            printf " \033[32m██████████\033[0m\033[2m░░░░░░░░░░\033[0m 50%%\n"
            printf "\n"
            printf " \033[32m✓\033[0m Build application\n"
            printf " \033[32m✓\033[0m Run tests\n"
            printf " \033[36m⠙\033[0m Deploy to staging\n"
            printf " \033[2m○ Deploy to production\033[0m\n"
            printf "\n"
            printf " \033[2mq=cancel\033[0m\n"
            ;;
        3)
            printf "\033[8A"
            printf " \033[1;36mDeployment\033[0m\033[2m (3/4)\033[0m\n"
            printf "\n"
            printf " \033[32m███████████████\033[0m\033[2m░░░░░\033[0m 75%%\n"
            printf "\n"
            printf " \033[32m✓\033[0m Build application\n"
            printf " \033[32m✓\033[0m Run tests\n"
            printf " \033[32m✓\033[0m Deploy to staging\n"
            printf " \033[36m⠹\033[0m Deploy to production\n"
            printf "\n"
            printf " \033[2mq=cancel\033[0m\n"
            ;;
        4)
            printf "\033[8A"
            printf " \033[1;36mDeployment\033[0m\033[2m (4/4)\033[0m\n"
            printf "\n"
            printf " \033[32m████████████████████\033[0m 100%%\n"
            printf "\n"
            printf " \033[32m✓\033[0m Build application\n"
            printf " \033[32m✓\033[0m Run tests\n"
            printf " \033[32m✓\033[0m Deploy to staging\n"
            printf " \033[32m✓\033[0m Deploy to production\n"
            printf "\n"
            printf " \033[1;32mComplete!\033[0m\n"
            ;;
    esac
done

sleep 1.5
clear

# ============================================
# DEMO 3: Checklist Component
# ============================================
printf "\n"
printf " \033[1;36mSelect features\033[0m\033[2m (2/4 checked)\033[0m\n"
printf "\n"
printf " \033[7m\033[32m☑\033[0m\033[7m JWT Authentication\033[0m\n"
printf " \033[32m☑\033[0m Rate limiting\n"
printf " \033[2m☐\033[0m OAuth integration\n"
printf " \033[2m☐\033[0m API versioning\n"
printf "\n"
printf "   [Done]\n"
printf "\n"
printf " \033[2mSpace=toggle  a=all  n=none  ↑↓=nav  Enter=done  q=cancel\033[0m\n"

sleep 1.5

# Show selection changes
printf "\033[7A"
printf " \033[1;36mSelect features\033[0m\033[2m (3/4 checked)\033[0m\n"
printf "\n"
printf " \033[32m☑\033[0m JWT Authentication\n"
printf " \033[32m☑\033[0m Rate limiting\n"
printf " \033[7m\033[32m☑\033[0m\033[7m OAuth integration\033[0m\n"
printf " \033[2m☐\033[0m API versioning\n"
printf "\n"
printf "   [Done]\n"

sleep 1

# Move to Done
printf "\033[6A"
printf " \033[1;36mSelect features\033[0m\033[2m (3/4 checked)\033[0m\n"
printf "\n"
printf " \033[32m☑\033[0m JWT Authentication\n"
printf " \033[32m☑\033[0m Rate limiting\n"
printf " \033[32m☑\033[0m OAuth integration\n"
printf " \033[2m☐\033[0m API versioning\n"
printf "\n"
printf " \033[7;32m  [Done]  \033[0m\n"

sleep 1
clear

# ============================================
# DEMO 4: Diff Component (simplified)
# ============================================
printf "\n"
printf " \033[1;36msrc/auth.ts\033[0m\033[2m +12 -3\033[0m\n"
printf "\n"
printf " \033[2m│\033[0m \033[2m  1\033[0m   import { jwt } from 'jsonwebtoken';\n"
printf " \033[2m│\033[0m \033[2m  2\033[0m   \n"
printf " \033[32m│\033[0m \033[32m+ 3\033[0m \033[32m  const SECRET = process.env.JWT_SECRET;\033[0m\n"
printf " \033[32m│\033[0m \033[32m+ 4\033[0m \033[32m  const EXPIRY = '7d';\033[0m\n"
printf " \033[2m│\033[0m \033[2m  5\033[0m   \n"
printf " \033[31m│\033[0m \033[31m- 6\033[0m \033[31m  export function verify(token) {\033[0m\n"
printf " \033[32m│\033[0m \033[32m+ 6\033[0m \033[32m  export function verify(token: string) {\033[0m\n"
printf " \033[32m│\033[0m \033[32m+ 7\033[0m \033[32m    return jwt.verify(token, SECRET);\033[0m\n"
printf " \033[2m│\033[0m \033[2m  8\033[0m   }\n"
printf "\n"
printf " \033[7;32m Approve \033[0m  \033[0m Reject \033[0m\n"
printf "\n"
printf " \033[2my/n=quick  ←→=switch  e=edit  Enter=confirm\033[0m\n"

sleep 2.5
clear

# ============================================
# DEMO 5: Table Component
# ============================================
printf "\n"
printf " \033[1;36mTest Results\033[0m\n"
printf "\n"
printf " \033[2m┌──────────┬───────┬────────┬────────┐\033[0m\n"
printf " \033[2m│\033[0m Suite    \033[2m│\033[0m Tests \033[2m│\033[0m Passed \033[2m│\033[0m Failed \033[2m│\033[0m\n"
printf " \033[2m├──────────┼───────┼────────┼────────┤\033[0m\n"
printf " \033[2m│\033[0m auth     \033[2m│\033[0m    12 \033[2m│\033[0m \033[32m    12\033[0m \033[2m│\033[0m \033[32m     0\033[0m \033[2m│\033[0m\n"
printf " \033[2m│\033[0m api      \033[2m│\033[0m    24 \033[2m│\033[0m \033[32m    23\033[0m \033[2m│\033[0m \033[31m     1\033[0m \033[2m│\033[0m\n"
printf " \033[2m│\033[0m ui       \033[2m│\033[0m     8 \033[2m│\033[0m \033[32m     8\033[0m \033[2m│\033[0m \033[32m     0\033[0m \033[2m│\033[0m\n"
printf " \033[2m└──────────┴───────┴────────┴────────┘\033[0m\n"
printf "\n"
printf " \033[2mq=close  ↑↓←→=scroll\033[0m\n"

sleep 2.5
clear

# ============================================
# Final Message
# ============================================
printf "\n"
printf "\033[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n"
printf "\n"
printf "  \033[1mAutonomous, not absent.\033[0m\n"
printf "\n"
printf "  \033[2mClaude works. You decide.\033[0m\n"
printf "\n"
printf "\033[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n"
printf "\n"

sleep 3
SCRIPT

chmod +x /tmp/real-demo.sh

echo "Recording component showcase demo..."

# Record with proper terminal size (v2 format for player compatibility)
asciinema rec \
    --overwrite \
    --cols 72 \
    --rows 20 \
    -f asciicast-v2 \
    -c "/tmp/real-demo.sh" \
    hero-demo.cast

rm -f /tmp/real-demo.sh

echo ""
echo "✓ Recording saved to: $SCRIPT_DIR/hero-demo.cast"
