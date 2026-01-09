import { writeFileSync } from "fs";

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
 * The IDE captures this from the tmux pane
 */
export const RESULT_PREFIX = "__MCP_RESULT__:";

/**
 * Progress protocol: Print this to stdout for intermediate updates
 * Allows Claude to track form progress via capture_pane
 */
export const PROGRESS_PREFIX = "__MCP_PROGRESS__:";

export function emitProgress(data: Record<string, unknown>): void {
  console.log(`${PROGRESS_PREFIX}${JSON.stringify(data)}`);
}

export function emitResult(result: FormResult): void {
  console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
}

/**
 * File-based result communication (more reliable than stdout)
 * Result files are stored in /tmp with pattern: mcp-interaction-{id}.result
 */
export const RESULT_FILE_DIR = "/tmp";

export function getResultFilePath(interactionId: string): string {
  return `${RESULT_FILE_DIR}/mcp-interaction-${interactionId}.result`;
}

/**
 * Write result to file synchronously - guarantees write completes before process exit
 */
export function writeResultFile(interactionId: string, result: FormResult): void {
  const filePath = getResultFilePath(interactionId);
  writeFileSync(filePath, JSON.stringify(result), "utf-8");
}

/**
 * Global interaction ID - set from command line args
 */
let _interactionId: string | undefined;

export function setInteractionId(id: string): void {
  _interactionId = id;
}

export function getInteractionId(): string | undefined {
  return _interactionId;
}

/**
 * Emit result via both file (reliable) and stdout (fallback/debugging)
 */
export function emitResultWithFile(result: FormResult): void {
  // Write to file first (synchronous, guaranteed)
  if (_interactionId) {
    writeResultFile(_interactionId, result);
  }
  // Also emit to stdout for backward compatibility and debugging
  emitResult(result);
}
