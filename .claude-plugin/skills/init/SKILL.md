---
name: init
description: "Initialize termos.md with project-specific instructions and preferences."
allowed-tools: Bash, AskUserQuestion, Write, Read
---

# Termos Init

Generate a `.termos/termos.md` file with project-specific instructions tailored to the user's setup.

## Step 1: Environment Detection

Check what's available:

```bash
# Check if Zellij is available
which zellij && echo "ZELLIJ_AVAILABLE" || echo "ZELLIJ_NOT_AVAILABLE"

# Check if Ghostty is available (macOS)
[ -d "/Applications/Ghostty.app" ] && echo "GHOSTTY_AVAILABLE" || echo "GHOSTTY_NOT_AVAILABLE"

# Check platform
uname -s
```

## Step 2: Ask User Preferences

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

## Step 3: Generate termos.md

Based on answers, generate `.termos/termos.md` with:

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

## Component Preferences
- Default position: {floating/floating:center/split}
- Confirmations: {floating:center for important, floating for routine}
```

## Step 4: Write the File

Create `.termos/` directory if needed and write `termos.md`.

Confirm with user before writing:
```bash
termos run --title "Confirm" confirm --prompt "Create .termos/termos.md with these settings?"
```

## Example Output

For a user who selected:
- IDE: Claude Code
- Style: Balanced
- Use cases: Confirmations, Progress, Always-on widgets
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
```
