import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const USER_INSTRUCTIONS_PATH = path.join(os.homedir(), ".termos", "termos.md");
const PROJECT_INSTRUCTIONS_FILE = "termos.md";
const PROJECT_INSTRUCTIONS_DIR = ".termos";

function loadUserInstructions(): string {
  try {
    if (fs.existsSync(USER_INSTRUCTIONS_PATH)) {
      return fs.readFileSync(USER_INSTRUCTIONS_PATH, "utf8").trim();
    }
  } catch {
    // Ignore read errors
  }
  return "";
}

function loadProjectInstructions(cwd: string): string {
  // Check .termos/termos.md first, then termos.md in root
  const dirPath = path.join(cwd, PROJECT_INSTRUCTIONS_DIR, PROJECT_INSTRUCTIONS_FILE);
  const rootPath = path.join(cwd, PROJECT_INSTRUCTIONS_FILE);

  try {
    if (fs.existsSync(dirPath)) {
      return fs.readFileSync(dirPath, "utf8").trim();
    }
    if (fs.existsSync(rootPath)) {
      return fs.readFileSync(rootPath, "utf8").trim();
    }
  } catch {
    // Ignore read errors
  }
  return "";
}

export function loadMergedInstructions(cwd: string): string {
  const userInstructions = loadUserInstructions();
  const projectInstructions = loadProjectInstructions(cwd);

  const parts: string[] = [];

  if (userInstructions) {
    parts.push(userInstructions);
  }

  if (projectInstructions) {
    parts.push(projectInstructions);
  }

  return parts.join("\n\n");
}

// TUI Editor configuration for embedded in-pane editing
export interface TuiEditorConfig {
  editor: string;
  command: string;
  lineFormat: string;
}

// Parse simple YAML-like config from termos.md
function parseSimpleYaml(yaml: string): TuiEditorConfig | null {
  const lines = yaml.trim().split("\n");
  const config: Partial<TuiEditorConfig> = {};

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*"?([^"]+)"?$/);
    if (match) {
      const [, key, value] = match;
      if (key === "editor") config.editor = value;
      else if (key === "command") config.command = value;
      else if (key === "lineFormat") config.lineFormat = value;
    }
  }

  if (config.editor && config.command && config.lineFormat) {
    return config as TuiEditorConfig;
  }
  return null;
}

// Load TUI editor config from termos.md
export function loadTuiEditorConfig(cwd: string): TuiEditorConfig | null {
  // Check project-level first, then user-level
  const projectInstructions = loadProjectInstructions(cwd);
  const userInstructions = loadUserInstructions();

  // Try project config first
  for (const instructions of [projectInstructions, userInstructions]) {
    if (!instructions) continue;

    // Look for TUI Editor YAML block
    const yamlMatch = instructions.match(/## TUI Editor\n```yaml\n([\s\S]*?)```/);
    if (yamlMatch) {
      const config = parseSimpleYaml(yamlMatch[1]);
      if (config) return config;
    }
  }

  return null;
}
