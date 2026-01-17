# Project: mcp-sidecar

## Environment
- IDE: Cursor
- Platform: macOS
- Zellij: available
- Ghostty: available

## Interaction Preferences
Proactive style: Show confirmations, progress, and status frequently to keep the user informed at every step.

## When to Use Termos

### Confirmations
Use `confirm` before:
- Deleting files or directories
- Overwriting existing files
- Running deployment commands
- Database migrations
- Any destructive or irreversible action

Example:
```bash
termos run --title "Delete Files" --position floating:center confirm --prompt "Delete 5 files from src/old/?"
```

### Progress Tracking
Use `progress` for operations with multiple steps (3+ steps):
```bash
termos run --title "Setup" --position floating:bottom-right progress --steps "Install deps,Build,Test,Deploy"
```

Update the current step as you complete each task.

### Code Review
Use `diff` before committing changes to show side-by-side comparison:
```bash
termos run --title "Review Changes" --position floating:center diff --file path/to/file
```

Always show diffs before:
- Committing code
- Merging branches
- Applying patches

### Data Display
Use appropriate components for structured data:
- `table` for tabular data and lists
- `json` for API responses and config files
- `chart` for metrics and statistics

Example:
```bash
termos run --title "API Response" --position floating:center table --data '...'
```

### Plan Mode
When entering plan mode, display the plan file in a centered pane:
```bash
termos run --title "Plan" --position floating:center plan-viewer --file <plan-path>
```

The user can approve (Y) or reject (N) directly from the pane.

### Task Progress
For multi-step tasks, show live progress in a corner pane:
```bash
termos run --title "Tasks" --position floating:bottom-right progress --steps "Step1,Step2,Step3"
```

Update current step as you complete each task. Keep this visible throughout the operation.

### User Engagement
Keep the user engaged while working:
- Periodically check in with quick questions using `ask`
- Keep 1-2 floating panes visible for status updates
- Use `floating:bottom-right` to stay unobtrusive

Example:
```bash
termos run --title "Quick Check" --position floating:bottom-right ask --prompt "All good so far?"
```

Best practices for engagement:
- Check in every few major steps
- Confirm before proceeding to new phases
- Show progress updates for long operations

## Component Preferences
- Default position: `floating:center` for important decisions
- Progress/status: `floating:bottom-right` to stay out of the way
- Confirmations: `floating:center` for visibility
- Data displays: `floating:center` for easy reading

## Quick Reference

| Component | Use Case | Default Position |
|-----------|----------|------------------|
| confirm | Before destructive actions | floating:center |
| progress | Multi-step operations | floating:bottom-right |
| diff | Code review before commits | floating:center |
| table | Structured data display | floating:center |
| ask | Quick questions/check-ins | floating:bottom-right |
| plan-viewer | Plan mode display | floating:center |
