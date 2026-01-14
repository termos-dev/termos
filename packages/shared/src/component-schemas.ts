/**
 * Component schemas - source of truth for CLI help generation
 */

export interface ArgSchema {
  type: "string" | "number" | "boolean" | "json";
  required?: boolean;
  default?: string;
  description: string;
}

export interface ComponentSchema {
  name: string;
  description: string;
  args: Record<string, ArgSchema>;
  returns: Record<string, string>;
  examples?: string[];
}

export const componentSchemas: Record<string, ComponentSchema> = {
  ask: {
    name: "ask",
    description: "Multi-question interactive form",
    args: {
      questions: { type: "json", description: "Inline JSON - array of question objects" },
      prompt: { type: "string", description: "Single-question prompt (shorthand)" },
      options: { type: "string", description: "Options for single-question prompt (CSV or JSON array)" },
      placeholder: { type: "string", description: "Placeholder for single-question prompt" },
      title: { type: "string", description: "Form title" },
    },
    returns: {
      action: "accept | cancel",
      answers: "Record<header, value> - answers keyed by question header",
    },
    examples: [
      'termos run ask --prompt "What is your name?" --placeholder "Enter your name..."',
      'termos run ask --prompt "Favorite language?" --options "TypeScript,Python,Go"',
      'termos run ask --questions \'[{"question":"Name?","options":["Alice","Bob"]}]\'',
    ],
  },

  confirm: {
    name: "confirm",
    description: "Yes/No confirmation dialog",
    args: {
      prompt: { type: "string", required: true, description: "Question to ask" },
      yes: { type: "string", default: "Yes", description: "Yes button label" },
      no: { type: "string", default: "No", description: "No button label" },
    },
    returns: {
      action: "accept | cancel",
      confirmed: "boolean - true if user selected yes",
    },
    examples: [
      'termos run confirm --prompt "Delete all files?"',
      'termos run confirm --prompt "Continue?" --yes "Proceed" --no "Abort"',
    ],
  },

  checklist: {
    name: "checklist",
    description: "Interactive checklist with toggleable items",
    args: {
      items: { type: "string", required: true, description: "Comma-separated list of items" },
      title: { type: "string", description: "Title above checklist" },
      checked: { type: "string", description: "Pre-checked indices (comma-separated)" },
    },
    returns: {
      action: "accept | cancel",
      checked: "number[] - indices of checked items",
      checkedLabels: "string[] - labels of checked items",
    },
    examples: [
      'termos run checklist --items "Build,Test,Deploy"',
      'termos run checklist --items "A,B,C" --checked "0,2" --title "Select"',
    ],
  },

  code: {
    name: "code",
    description: "Syntax-highlighted code viewer",
    args: {
      file: { type: "string", required: true, description: "Path to source file" },
      highlight: { type: "string", description: "Line range to highlight (e.g. '10-20')" },
      line: { type: "number", description: "Scroll to line number" },
    },
    returns: {
      action: "accept",
      file: "string - path to file",
    },
    examples: [
      'termos run code --file src/index.ts',
      'termos run code --file src/app.tsx --highlight "15-25" --line 15',
    ],
  },

  diff: {
    name: "diff",
    description: "Show file changes (git diff or file comparison)",
    args: {
      file: { type: "string", description: "File path for git diff" },
      staged: { type: "boolean", description: "Show staged changes" },
      before: { type: "string", description: "Before file for comparison" },
      after: { type: "string", description: "After file for comparison" },
    },
    returns: {
      action: "accept",
    },
    examples: [
      'termos run diff --file src/index.ts',
      'termos run diff --file src/index.ts --staged',
      'termos run diff --before old.txt --after new.txt',
    ],
  },

  table: {
    name: "table",
    description: "Display tabular data from JSON or CSV",
    args: {
      file: { type: "string", required: true, description: "Path to JSON or CSV file" },
      columns: { type: "string", description: "Columns to display (comma-separated)" },
    },
    returns: {
      action: "accept",
    },
    examples: [
      'termos run table --file data.json',
      'termos run table --file data.csv --columns "name,status,date"',
    ],
  },

  progress: {
    name: "progress",
    description: "Progress indicator with steps",
    args: {
      steps: { type: "string", required: true, description: "Comma-separated list of steps" },
      title: { type: "string", description: "Progress title" },
    },
    returns: {
      action: "accept",
    },
    examples: [
      'termos run progress --steps "Build,Test,Deploy"',
      'termos run progress --steps "Step 1,Step 2" --title "Installation"',
    ],
  },

  mermaid: {
    name: "mermaid",
    description: "Render Mermaid diagrams",
    args: {
      file: { type: "string", description: "Path to .mmd file" },
      code: { type: "string", description: "Inline mermaid code" },
    },
    returns: {
      action: "accept",
    },
    examples: [
      'termos run mermaid --file diagram.mmd',
      'termos run mermaid --code "flowchart LR; A-->B-->C"',
    ],
  },

  markdown: {
    name: "markdown",
    description: "Render markdown file with scrolling",
    args: {
      file: { type: "string", required: true, description: "Path to markdown file" },
      title: { type: "string", description: "Title above content" },
    },
    returns: {
      action: "accept",
      file: "string - path to file",
    },
    examples: [
      'termos run markdown --file README.md',
      'termos run markdown --file plan.md --title "Implementation Plan"',
    ],
  },

  "plan-viewer": {
    name: "plan-viewer",
    description: "Review a plan file with approve/reject controls",
    args: {
      file: { type: "string", required: true, description: "Path to plan file" },
    },
    returns: {
      action: "accept | cancel",
      result: "{ approved: boolean, file?: string }",
    },
    examples: [
      'termos run plan-viewer --file /path/to/plan.md',
    ],
  },
};

/**
 * Generate help text for a component
 */
export function generateComponentHelp(schema: ComponentSchema): string {
  const lines: string[] = [];

  lines.push(`${schema.name} - ${schema.description}`);
  lines.push('');

  // Usage
  const requiredArgs = Object.entries(schema.args)
    .filter(([_, arg]) => arg.required)
    .map(([name, _]) => `--${name} <value>`)
    .join(' ');
  const geometryFlags = "[--width <0-100> --height <0-100> --x <0-100> --y <0-100>]";
  lines.push(`  Usage: termos run ${geometryFlags} ${schema.name} ${requiredArgs}`.trimEnd());
  lines.push('');

  // Options
  lines.push('  Options:');
  for (const [name, arg] of Object.entries(schema.args)) {
    const req = arg.required ? '(required)' : '';
    const def = arg.default ? `(default: ${arg.default})` : '';
    lines.push(`    --${name.padEnd(12)} ${arg.description} ${req} ${def}`.trimEnd());
  }
  lines.push('');

  // Returns
  lines.push('  Returns:');
  for (const [name, desc] of Object.entries(schema.returns)) {
    lines.push(`    ${name}: ${desc}`);
  }

  // Examples
  if (schema.examples?.length) {
    lines.push('');
    lines.push('  Examples:');
    for (const ex of schema.examples) {
      lines.push(`    ${ex}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate full help text for all components
 */
export function generateFullHelp(): string {
  const sections: string[] = [];

  sections.push(`termos run - Run interactive components

Usage:
  termos run <component> [options]    Run a built-in or custom component
  termos run -- <command>             Run a shell command in a floating pane
  termos run --help                   Show this help

Global Options:
  --title "Text"              Display a title header above the component
  --wait                      Wait for component to complete (optional)
  --no-wait                   Return immediately with interaction ID (default)
  --width <0-100>             Pane width percentage (required for custom/command)
  --height <0-100>            Pane height percentage (required for custom/command)
  --x <0-100>                 Pane X position percentage (required for custom/command)
  --y <0-100>                 Pane Y position percentage (required for custom/command)
  Defaults (built-ins): width 40, height 50, x 60, y 5 (top-right)
  Note: geometry is ignored when using the macOS Terminal host
`);

  for (const schema of Object.values(componentSchemas)) {
    sections.push('━'.repeat(80));
    sections.push('');
    sections.push(generateComponentHelp(schema));
    sections.push('');
  }

  sections.push('━'.repeat(80));
  sections.push('');
  sections.push(`Custom Components:

  Usage: termos run --width <0-100> --height <0-100> --x <0-100> --y <0-100> ./my-component.tsx [--key value]

  Create .tsx files with a default export React component.
  Use global onComplete(result) to return data.
  Pass arguments via --key value flags.
`);

  return sections.join('\n');
}
