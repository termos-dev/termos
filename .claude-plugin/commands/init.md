---
allowed-tools: Bash, AskUserQuestion, Write, Read
---

Initialize termos.md with project-specific instructions and preferences.

# Termos Init

Generate a `termos.md` file in the project root with project-specific instructions tailored to the user's setup.

## Step 0: Check for Existing termos.md

Before starting the wizard, check if a `termos.md` file already exists:

```bash
if [ -f "termos.md" ]; then
  echo "EXISTING_CONFIG=yes"
  cat termos.md
else
  echo "EXISTING_CONFIG=no"
fi
```

If `termos.md` exists, parse the current settings to use as defaults:

### Parsing Rules

1. **Editor**: Extract from yaml block under `## Editor`:
   ```
   editor: nvim  →  detected_editor="nvim"
   ```

2. **Interaction Style**: Look for keywords in `## Interaction Preferences`:
   - "frequently" or "Proactive" → `proactive`
   - "essential" or "Minimal" → `minimal`
   - "important" or "Balanced" → `balanced`

3. **Use Cases**: Check which subsections exist under `## When to Use Termos`:
   - `### Confirmations` present → confirmations enabled
   - `### Progress Tracking` present → multi-step tasks enabled
   - `### Code Review` present → code review enabled
   - `### Data Display` present → data display enabled
   - `### Always-On Widgets` present → always-on widgets enabled
   - `### Command Tabs` present → command output enabled

4. **Feature Flags**: Check for section presence:
   - `### Plan Mode` present → plan mode enabled
   - `### Task Progress` present → task progress enabled
   - `### User Engagement` present → user engagement enabled
   - `### Live Git Diff` present → git diff enabled

When showing questions, mark detected values as "(Current)" instead of "(Recommended)".

---

## Step 1: Environment Detection & Explanation

Check environment and explain to user:

```bash
# Detect environment
ZELLIJ_ACTIVE=""
ZELLIJ_INSTALLED=""
PLATFORM=$(uname -s)

[ -n "$ZELLIJ_SESSION_NAME" ] && ZELLIJ_ACTIVE="yes"
which zellij > /dev/null 2>&1 && ZELLIJ_INSTALLED="yes"
[ -d "/Applications/Ghostty.app" ] && GHOSTTY_AVAILABLE="yes"

# Detect all available editors
EDITORS=""

# TUI editors (can run in-pane)
which nvim > /dev/null 2>&1 && EDITORS="$EDITORS nvim"
which vim > /dev/null 2>&1 && EDITORS="$EDITORS vim"
which hx > /dev/null 2>&1 && EDITORS="$EDITORS hx"
which micro > /dev/null 2>&1 && EDITORS="$EDITORS micro"
which nano > /dev/null 2>&1 && EDITORS="$EDITORS nano"
which emacs > /dev/null 2>&1 && EDITORS="$EDITORS emacs"

# GUI editors
which code > /dev/null 2>&1 && EDITORS="$EDITORS code"
which cursor > /dev/null 2>&1 && EDITORS="$EDITORS cursor"

# macOS app detection (if CLI not found but app exists)
[ -d "/Applications/Visual Studio Code.app" ] && ! echo "$EDITORS" | grep -q "code" && EDITORS="$EDITORS code"
[ -d "/Applications/Cursor.app" ] && ! echo "$EDITORS" | grep -q "cursor" && EDITORS="$EDITORS cursor"

echo "Platform: $PLATFORM"
echo "In Zellij: ${ZELLIJ_ACTIVE:-no}"
echo "Zellij installed: ${ZELLIJ_INSTALLED:-no}"
echo "Ghostty: ${GHOSTTY_AVAILABLE:-no}"
echo "Editors:$EDITORS"
```

### Explain Environment to User

Based on detection, explain the experience they'll get:

**If inside Zellij (`ZELLIJ_ACTIVE=yes`):**
> You're running inside Zellij - this gives you the best experience:
> - **Split panes**: Side-by-side views for diffs, progress, code
> - **Floating panes**: Overlay windows that don't disrupt your layout
> - **Tabs**: Organize different termos views
> - **Integrated**: Everything stays in one terminal window
>
> All termos features are fully supported!

**If macOS without Zellij:**
> You're on macOS outside Zellij. Termos will use Ghostty or Terminal:
> - **Separate windows**: Each interaction opens in a new window
> - **No split panes**: `split:right` and `split:down` aren't available
> - **Still functional**: Floating positions work as separate windows
>
> For the best experience with split panes, run inside Zellij:
> `zellij attach --create $(basename $PWD)`

**If Linux without Zellij:**
> On Linux, termos requires Zellij for pane management.
> Start a Zellij session: `zellij attach --create $(basename $PWD)`
> Then run `termos init` again inside the session.

## Step 2: Ask User Preferences

Use AskUserQuestion to gather preferences.

**If existing termos.md was detected in Step 0:**
- Mark detected values as "(Current)" instead of "(Recommended)"
- Pre-select current values as the default option
- This lets users keep existing settings or change them

### Question 1: Preferred Editor
Based on detected editors (from Step 1), ask which editor they prefer:
- List all detected editors as options
- First detected TUI editor (nvim, vim, hx) should be marked as recommended
- Users can select "Other" to enter a custom editor command

Editor type determines behavior:
- **TUI editors** (nvim, vim, hx, micro, nano, emacs): Enable in-pane editing
- **GUI editors** (code, cursor): Open files externally only

Example options if `nvim`, `code`, `cursor` were detected:
- **nvim (Recommended)**: Neovim - in-pane editing enabled
- **vim**: Vim - in-pane editing enabled
- **code**: VS Code - opens files externally
- **cursor**: Cursor - opens files externally

Editor reference table:
| Editor | Type | Command | Line Format |
|--------|------|---------|-------------|
| nvim | TUI | `nvim` | `+{line}` |
| vim | TUI | `vim` | `+{line}` |
| hx | TUI | `hx` | `{file}:{line}` |
| micro | TUI | `micro` | `+{line}` |
| nano | TUI | `nano` | `+{line}` |
| emacs | TUI | `emacs -nw` | `+{line}` |
| code | GUI | `code` | `-g {file}:{line}` |
| cursor | GUI | `cursor` | `-g {file}:{line}` |

If no editors detected, skip this question and use system default.

### Question 2: Interaction Style
Ask their preferred interaction style:
- **Proactive**: Show confirmations, progress, and status frequently
- **Minimal**: Only show interactions when essential
- **Balanced**: Show for important decisions, skip trivial ones

### Question 3: Use Cases (multi-select)
Ask which use cases apply to their workflow:
- **Confirmations**: Before destructive actions (delete, overwrite, deploy)
- **Multi-step tasks**: Show progress for long-running operations
- **Code review**: Show diffs before commits
- **Data display**: Tables, charts, JSON viewers for data exploration
- **Always-on widgets**: Keep a quiz/status panel visible (1-2 questions active)
- **Command output**: Run commands in visible tabs (Zellij only)

### Question 4: Plan Mode Display
Ask if they want plan files shown in a pane:
- **Yes (Recommended)**: Display plan file in a centered pane during plan mode
- **No**: Keep plans in the editor only

### Question 5: Task Progress Display
Ask if they want task progress shown as a pane:
- **Yes (Recommended)**: Show live task progress in a corner pane
- **No**: Track tasks without visual display

### Question 6: User Engagement
Ask if they want periodic check-ins while Claude works:
- **Yes (Recommended)**: Keep me engaged with questions and status updates
- **No**: Only interact when necessary

### Question 7: Live Git Diff Pane (Zellij only)
If user is in Zellij, ask if they want a persistent git diff pane:
- **Yes (Recommended)**: Show live git diff in a split pane while coding
- **No**: Skip git diff pane

This pane shows `git diff` output and updates continuously.
Command: `termos run --title "Git Diff" --position split:right --cmd "watch -n5 -c 'git diff --color=always'"`

## Step 3: Generate termos.md

Based on answers, generate `termos.md` in the project root with:

### Template Structure

```markdown
# Project: {project_name}

## Environment
- Platform: {platform}
- Zellij: {available/not available}

## Editor
```yaml
editor: {editor}
type: {tui|gui}
command: {editor_command}
lineFormat: "{line_format}"
```

{if type is TUI:}
In-pane editing enabled. Press `e` in code viewer to edit with {editor}.
After editing, the viewer restarts so you can review changes.
{else:}
Opens files externally in {editor}. Press `e` in code viewer to open file.
{endif}

## Interaction Preferences
{based on style choice}

## When to Use Termos

### Confirmations
{if selected: Use `confirm` before destructive actions like deleting files, overwriting data, or deploying.}

### Progress Tracking
{if selected: Use `progress` for multi-step tasks. Show checklist for operations with 3+ steps.}

### Code Review
{if selected: Use `diff` before committing changes. Show side-by-side comparison.}

### Data Display
{if selected: Use `table` for structured data, `json` for API responses, `chart` for metrics.}

### Always-On Widgets
{if selected: Keep interactive components like quizzes visible. Example:
- Run `termos run --title "Quick Check" ask --prompt "Ready to proceed?"`
- Keep 1-2 questions active for user engagement
- Use `floating:bottom-right` to stay out of the way}

### Command Tabs (Zellij only)
{if zellij available and selected: Run long commands in tabs:
`termos run --title "Dev Server" --position tab -- npm run dev`}

### Plan Mode
{if selected: When entering plan mode, display the plan file in a centered pane:
`termos run --title "Plan" --position floating:center plan-viewer --file <plan-path>`
The user can approve (Y) or reject (N) directly from the pane.}

### Task Progress
{if selected: For multi-step tasks, show live progress in a corner pane:
`termos run --title "Tasks" --position floating:bottom-right progress --steps "Step1,Step2,..."`
Update the current step as you complete each task.}

### User Engagement
{if selected: Keep the user engaged while working:
- Periodically check in with quick questions using `ask`
- Keep 1-2 floating panes visible for status
- Use `floating:bottom-right` to stay unobtrusive
Example: `termos run --title "Quick Check" --position floating:bottom-right ask --prompt "All good so far?"`}

### Live Git Diff Pane (Zellij only)
{if selected: Show live git diff in a split pane while coding:
`termos run --title "Git Diff" --position split:right --cmd "watch -n5 -c 'git diff --color=always'"`
This updates continuously as you make changes.
Start this when beginning a coding session.}

## Component Preferences
- Default position: {floating/floating:center/split}
- Confirmations: {floating:center for important, floating for routine}
```

## Step 4: Write the File

Write `termos.md` to the project root.

Confirm with user before writing:
```bash
termos run --title "Confirm" confirm --prompt "Create termos.md with these settings?"
```

## Step 5: Update CLAUDE.md

If a `CLAUDE.md` exists in the project root, append termos instructions so Claude actively uses interactive components:

```bash
if [ -f "CLAUDE.md" ]; then
  cat >> CLAUDE.md << 'EOF'

## Termos Interactive Components

This project uses termos for interactive UI. Read `termos.md` for interaction preferences.

Workflow:
1. `termos run ...` spawns pane, returns interaction ID
2. `termos wait <id> &` runs in background (non-blocking)
3. `termos result` checks all results, or `termos result <id>` for specific one

Tip: Run wait in background so user isn't blocked while interacting with the pane.

- **USE termos components** for confirmations, progress, and user engagement
- **Show plan files** in a pane during plan mode (if enabled in termos.md)
- **Display task progress** visually for multi-step operations

Run `termos --help` for available components. Always use `--title` and `--position` flags.
EOF
fi
```

If no `CLAUDE.md` exists, ask the user if they want to create one with termos instructions.

## Example Output

For a user who selected:
- Editor: nvim
- Style: Balanced
- Use cases: Confirmations, Progress, Always-on widgets
- Plan mode display: Yes
- Task progress display: Yes
- User engagement: Yes
- Zellij available

```markdown
# Project: my-app

## Environment
- Platform: macOS
- Zellij: available

## Editor
```yaml
editor: nvim
type: tui
command: nvim
lineFormat: "+{line}"
```

In-pane editing enabled. Press `e` in code viewer to edit with nvim.
After editing, the viewer restarts so you can review changes.

## Interaction Preferences
Show interactions for important decisions. Skip trivial confirmations.

## When to Use Termos

### Confirmations
Use `confirm` before:
- Deleting files or directories
- Overwriting existing files
- Running deployment commands
- Database migrations

Example:
termos run --title "Delete Files" confirm --prompt "Delete 5 files from src/old/?"

### Progress Tracking
Use `progress` for operations with multiple steps:
termos run --title "Setup" progress --steps "Install deps,Build,Test,Deploy"

### Always-On Widgets
Keep engagement high with persistent interactions:
- Use `floating:bottom-right` for status panels
- Keep 1-2 quick questions visible
- Great for quizzes, polls, or status checks

Example:
termos run --title "Quick Poll" --position floating:bottom-right ask --prompt "How's the progress?"

### Plan Mode
When entering plan mode, display the plan file:
termos run --title "Plan" --position floating:center plan-viewer --file ~/.claude/plans/plan-name.md

User can approve (Y) or reject (N) directly from the pane.

### Task Progress
For multi-step tasks, show live progress:
termos run --title "Tasks" --position floating:bottom-right progress --steps "Setup,Build,Test,Deploy"

Update current step as you complete each task.

### User Engagement
Keep the user engaged while working:
- Periodically check in with quick questions
- Keep 1-2 floating panes visible for status
- Use `floating:bottom-right` to stay unobtrusive

Example:
termos run --title "Quick Check" --position floating:bottom-right ask --prompt "All good so far?"
```
