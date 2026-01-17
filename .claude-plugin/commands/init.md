---
allowed-tools: Bash, AskUserQuestion, Write, Read
---

Initialize termos.md with project-specific instructions and preferences.

# Termos Init

Generate a `termos.md` file in the project root with project-specific instructions tailored to the user's setup.

## Step 1: Start Termos

Start `termos up` first (required for interactive confirmations):

```bash
termos up
```

This runs in the background and streams events. Keep it running throughout init.

## Step 2: Environment Detection

Check what's available:

```bash
# Check if Zellij is available
which zellij && echo "ZELLIJ_AVAILABLE" || echo "ZELLIJ_NOT_AVAILABLE"

# Check if Ghostty is available (macOS)
[ -d "/Applications/Ghostty.app" ] && echo "GHOSTTY_AVAILABLE" || echo "GHOSTTY_NOT_AVAILABLE"

# Check platform
uname -s
```

## Step 3: Ask User Preferences

Use AskUserQuestion to gather preferences:

### Question 1: IDE
Ask which IDE/editor they're using:
- Claude Code (CLI)
- Cursor
- VS Code with Claude extension
- Other

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

## Step 4: Generate termos.md

Based on answers, generate `termos.md` in the project root with:

### Template Structure

```markdown
# Project: {project_name}

## Environment
- IDE: {ide}
- Platform: {platform}
- Zellij: {available/not available}

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

## Component Preferences
- Default position: {floating/floating:center/split}
- Confirmations: {floating:center for important, floating for routine}
```

## Step 5: Write the File

Write `termos.md` to the project root.

Confirm with user before writing:
```bash
termos run --title "Confirm" confirm --prompt "Create termos.md with these settings?"
```

## Step 6: Update CLAUDE.md

If a `CLAUDE.md` exists in the project root, append termos instructions so Claude actively uses interactive components:

```bash
if [ -f "CLAUDE.md" ]; then
  cat >> CLAUDE.md << 'EOF'

## Termos Interactive Components

This project uses termos for interactive UI. **Run `termos up` first**, then read `termos.md` for preferences.

- **USE termos components** for confirmations, progress, and user engagement
- **Show plan files** in a pane during plan mode (if enabled in termos.md)
- **Display task progress** visually for multi-step operations
- **Keep the user engaged** with periodic check-ins and status panes

Run `termos --help` for available components. Always use `--title` and `--position` flags.
EOF
fi
```

If no `CLAUDE.md` exists, ask the user if they want to create one with termos instructions.

## Example Output

For a user who selected:
- IDE: Claude Code
- Style: Balanced
- Use cases: Confirmations, Progress, Always-on widgets
- Plan mode display: Yes
- Task progress display: Yes
- User engagement: Yes
- Zellij available

```markdown
# Project: my-app

## Environment
- IDE: Claude Code
- Platform: macOS
- Zellij: available

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
