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
      'termos run --title "Question" ask --prompt "What is your name?" --placeholder "Enter your name..."',
      'termos run --title "Question" ask --prompt "Favorite language?" --options "TypeScript,Python,Go"',
      'termos run --title "Question" ask --questions \'[{"question":"Name?","options":["Alice","Bob"]}]\'',
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
      'termos run --title "Confirm" confirm --prompt "Delete all files?"',
      'termos run --title "Confirm" confirm --prompt "Continue?" --yes "Proceed" --no "Abort"',
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
      'termos run --title "Checklist" checklist --items "Build,Test,Deploy"',
      'termos run --title "Checklist" checklist --items "A,B,C" --checked "0,2"',
    ],
  },

  code: {
    name: "code",
    description: "Syntax-highlighted code viewer with embedded editing",
    args: {
      file: { type: "string", required: true, description: "Path to source file" },
      highlight: { type: "string", description: "Line range to highlight (e.g. '10-20')" },
      line: { type: "number", description: "Scroll to line number" },
      editor: { type: "string", description: "External editor command (e.g. 'code --goto', 'vim +{line}')" },
      embeddedEditor: { type: "string", description: "TUI editor command for in-pane editing (e.g. 'nvim +{line}', 'hx {file}:{line}')" },
    },
    returns: {
      action: "accept | edit",
      file: "string - path to file",
      line: "number - current line (when action=edit)",
    },
    examples: [
      'termos run --title "Code" code --file src/index.ts',
      'termos run --title "Code" code --file src/app.tsx --highlight "15-25" --line 15',
      'termos run --title "Code" code --file src/index.ts --embeddedEditor "nvim +{line}"',
    ],
  },

  edit: {
    name: "edit",
    description: "Open file in TUI editor (embedded in pane)",
    args: {
      file: { type: "string", required: true, description: "Path to file to edit" },
      line: { type: "number", description: "Line number to jump to" },
      editor: { type: "string", required: true, description: "TUI editor command (e.g. 'nvim +{line}', 'hx {file}:{line}', 'vim +{line}')" },
    },
    returns: {
      action: "accept",
      file: "string - path to file",
    },
    examples: [
      'termos run --title "Edit" edit --file src/index.ts --editor "nvim +{line}"',
      'termos run --title "Edit" edit --file src/app.tsx --line 42 --editor "vim +{line}"',
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
      'termos run --title "Diff" diff --file src/index.ts',
      'termos run --title "Diff" diff --file src/index.ts --staged',
      'termos run --title "Diff" diff --before old.txt --after new.txt',
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
      'termos run --title "Table" table --file data.json',
      'termos run --title "Table" table --file data.csv --columns "name,status,date"',
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
      'termos run --title "Progress" progress --steps "Build,Test,Deploy"',
      'termos run --title "Progress" progress --steps "Step 1,Step 2"',
    ],
  },

  mermaid: {
    name: "mermaid",
    description: "Render Mermaid diagrams as ASCII flowcharts",
    args: {
      file: { type: "string", description: "Path to .mmd file" },
      code: { type: "string", description: "Inline mermaid code" },
      title: { type: "string", description: "Title above diagram" },
      editor: { type: "string", description: "Editor command to open file (e.g. 'code', 'vim')" },
    },
    returns: {
      action: "accept | edit",
      file: "string - path to file (when action=edit)",
      editor: "string - editor command (when action=edit)",
    },
    examples: [
      'termos run --title "Mermaid" mermaid --file diagram.mmd',
      'termos run --title "Mermaid" mermaid --code "flowchart LR; A-->B-->C"',
      'termos run --title "Mermaid" mermaid --file diagram.mmd --editor "code"',
    ],
  },

  markdown: {
    name: "markdown",
    description: "Render markdown content or file with scrolling",
    args: {
      file: { type: "string", description: "Path to markdown file" },
      content: { type: "string", description: "Inline markdown content" },
      title: { type: "string", description: "Title above content" },
    },
    returns: {
      action: "accept",
      file: "string - path to file (when using --file)",
    },
    examples: [
      'termos run --title "Markdown" markdown --file README.md',
      'termos run --title "Markdown" markdown --content "# Hello\\n\\n**Bold** text"',
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
      'termos run --title "Plan" plan-viewer --file /path/to/plan.md',
    ],
  },

  chart: {
    name: "chart",
    description: "Terminal charts (bar, sparkline, line, stacked)",
    args: {
      file: { type: "string", description: "Path to JSON or CSV data file" },
      data: { type: "json", description: "Inline JSON data array" },
      type: { type: "string", default: "bar", description: "Chart type: bar | sparkline | line | stacked" },
      title: { type: "string", description: "Chart title" },
      height: { type: "number", default: "8", description: "Chart height in rows (for line graphs)" },
      sort: { type: "string", default: "none", description: "Sort order: none | asc | desc (for bar charts)" },
      showValues: { type: "boolean", default: "true", description: "Show values next to bars" },
    },
    returns: {
      action: "accept",
      type: "string - chart type used",
    },
    examples: [
      'termos run --title "Sales" chart --file data.json',
      'termos run --title "Trend" chart --data "[5,10,15,8,12]" --type sparkline',
      'termos run --title "Revenue" chart --file sales.csv --type bar --sort desc',
      'termos run --title "Languages" chart --data \'[{"label":"TS","value":60},{"label":"JS","value":30}]\' --type stacked',
    ],
  },

  select: {
    name: "select",
    description: "Single-item picker with optional fuzzy search",
    args: {
      items: { type: "string", required: true, description: "Comma-separated items or JSON array" },
      title: { type: "string", description: "Title above list" },
      search: { type: "boolean", default: "false", description: "Enable fuzzy search filtering" },
      file: { type: "string", description: "JSON file with items array" },
    },
    returns: {
      action: "accept | cancel",
      selected: "string - selected item value",
      selectedLabel: "string - selected item label",
      selectedIndex: "number - index of selected item",
    },
    examples: [
      'termos run --title "Select" select --items "Option A,Option B,Option C"',
      'termos run --title "Select" select --items \'[{"label":"Node","value":"node"},{"label":"Python","value":"python"}]\' --search true',
      'termos run --title "Select" select --file options.json --search true',
    ],
  },

  tree: {
    name: "tree",
    description: "Directory/hierarchy tree viewer with expand/collapse",
    args: {
      path: { type: "string", description: "Directory path to display (default: cwd)" },
      file: { type: "string", description: "JSON file with tree structure" },
      depth: { type: "number", default: "5", description: "Max depth to show" },
      showHidden: { type: "boolean", default: "false", description: "Show hidden files" },
      title: { type: "string", description: "Title above tree" },
    },
    returns: {
      action: "accept | cancel",
      selected: "string - path of selected item",
      type: "string - 'file' or 'directory'",
    },
    examples: [
      'termos run --title "Tree" tree',
      'termos run --title "Tree" tree --path ./src --depth 3',
      'termos run --title "Tree" tree --path . --showHidden true',
    ],
  },

  json: {
    name: "json",
    description: "Interactive JSON explorer with collapsible nodes",
    args: {
      file: { type: "string", description: "Path to JSON file" },
      data: { type: "json", description: "Inline JSON data" },
      title: { type: "string", description: "Title above viewer" },
      expandDepth: { type: "number", default: "2", description: "Initial expand depth" },
    },
    returns: {
      action: "accept | cancel",
    },
    examples: [
      'termos run --title "JSON" json --file config.json',
      'termos run --title "JSON" json --data \'{"name":"test","items":[1,2,3]}\'',
      'termos run --title "JSON" json --file data.json --expandDepth 1',
    ],
  },

  gauge: {
    name: "gauge",
    description: "Visual meter/progress indicator for single values",
    args: {
      value: { type: "number", description: "Current value" },
      min: { type: "number", default: "0", description: "Minimum value" },
      max: { type: "number", default: "100", description: "Maximum value" },
      label: { type: "string", description: "Gauge label" },
      unit: { type: "string", default: "%", description: "Unit suffix (%, MB, °C, etc.)" },
      style: { type: "string", default: "bar", description: "Style: bar | arc | blocks | dots" },
      thresholds: { type: "json", description: 'Color thresholds: {"warning":70,"danger":90}' },
      file: { type: "string", description: "JSON file to watch for value updates" },
      data: { type: "json", description: "JSON with single or multiple gauges" },
      title: { type: "string", description: "Title above gauge" },
    },
    returns: {
      action: "accept",
      gauges: "array of {value, label} for each gauge",
    },
    examples: [
      'termos run --title "CPU" gauge --value 75 --label "CPU Usage"',
      'termos run --title "Memory" gauge --value 8 --max 16 --unit "GB" --style blocks',
      'termos run --title "Temp" gauge --value 65 --unit "°C" --thresholds \'{"warning":60,"danger":80}\'',
      'termos run --title "Stats" gauge --data \'[{"label":"CPU","value":45},{"label":"Memory","value":72}]\'',
    ],
  },
};

/**
 * Valid position presets
 */
export const POSITION_PRESETS = [
  "floating",
  "floating:center",
  "floating:top-left",
  "floating:top-right",
  "floating:bottom-left",
  "floating:bottom-right",
  "split",
  "split:right",
  "split:down",
  "tab",
] as const;

/**
 * Global options schema - applies to all `termos run` commands
 */
export const globalOptionsSchema: Record<string, ArgSchema> = {
  position: {
    type: "string",
    required: true,
    description: `Pane position preset: ${POSITION_PRESETS.join(", ")}`,
  },
  title: {
    type: "string",
    required: true,
    description: "Title for the pane",
  },
  session: {
    type: "string",
    required: false,
    description: "Session name (auto-generated from dir name on macOS)",
  },
  cmd: {
    type: "string",
    required: false,
    description: "Inline shell command (supports &&, |, ||, etc.)",
  },
  "cmd-file": {
    type: "string",
    required: false,
    description: "Read command from file",
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
  lines.push(`  Usage: termos run --title "<text>" ${schema.name} ${requiredArgs}`.trimEnd());
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
 * Generate help text for global options from schema
 */
function generateGlobalOptionsHelp(): string {
  const lines: string[] = [];
  for (const [name, arg] of Object.entries(globalOptionsSchema)) {
    const req = arg.required ? '(required)' : '';
    lines.push(`  --${name.padEnd(20)} ${arg.description} ${req}`.trimEnd());
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
  termos run <component> [options]           Run a built-in or custom component
  termos run --cmd "<command>"               Run a shell command (recommended for agents)
  termos run --cmd-file <path>               Run a shell command from file
  termos run -- <command>                    Run a shell command (passthrough)
  termos run --help                          Show this help

Command Execution:
  Use --cmd for commands with shell operators (&&, |, ||):
    termos run --title "Build" --cmd "npm run build && echo Done"
    termos run --title "Deploy" --cmd "ssh user@host 'deploy.sh && restart'"
  Use --cmd-file for complex multi-line scripts:
    termos run --title "Setup" --cmd-file ./scripts/setup.sh
  Use -- passthrough for simple commands (no operators):
    termos run --title "List" -- ls -la

Global Options:
${generateGlobalOptionsHelp()}
  Note: split positions only work in Zellij; other hosts fall back to a new window/tab
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

  Usage: termos run --title "<text>" ./my-component.tsx [--key value]

  Create .tsx files with a default export React component.
  Use global onComplete(result) to return data.
  Pass arguments via --key value flags.
  Use --position to control placement (required).
`);

  return sections.join('\n');
}
