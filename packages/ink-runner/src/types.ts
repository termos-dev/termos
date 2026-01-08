/**
 * Schema types matching Claude Code's AskUserQuestion format
 */

export interface FormOption {
  label: string;
  description?: string;
}

export interface FormQuestion {
  question: string;
  header: string;
  options?: FormOption[];
  multiSelect?: boolean;
  // Extensions for text inputs
  inputType?: "text" | "textarea" | "password";
  placeholder?: string;
  validation?: string; // Regex pattern
}

export interface FormSchema {
  questions: FormQuestion[];
}

export type FormAction = "accept" | "decline" | "cancel";

export interface FormResult {
  action: FormAction;
  answers?: Record<string, string | string[]>;
}

/**
 * Output protocol: Print this to stdout when form completes
 * The sidecar captures this from the tmux pane
 */
export const RESULT_PREFIX = "__MCP_RESULT__:";

export function emitResult(result: FormResult): void {
  console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
}
