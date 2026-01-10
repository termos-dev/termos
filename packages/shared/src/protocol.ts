import { writeFileSync, appendFileSync } from "fs";

/**
 * Environment variables injected when running interactions
 */
export const ENV_INTERACTION_ID = "MCP_INTERACTION_ID";
export const ENV_RESULT_FILE = "MCP_RESULT_FILE";
export const ENV_PROGRESS_FILE = "MCP_PROGRESS_FILE";

/**
 * File paths for interaction protocol
 */
export const RESULT_FILE_DIR = "/tmp";

export function getResultFilePath(interactionId: string): string {
  return `${RESULT_FILE_DIR}/mcp-interaction-${interactionId}.result`;
}

export function getProgressFilePath(interactionId: string): string {
  return `${RESULT_FILE_DIR}/mcp-interaction-${interactionId}.progress`;
}

/**
 * Stdout prefixes for fallback communication
 */
export const RESULT_PREFIX = "__MCP_RESULT__:";
export const PROGRESS_PREFIX = "__MCP_PROGRESS__:";

/**
 * Result types
 */
export type FormAction = "accept" | "decline" | "cancel" | "timeout";

export interface FormResult {
  action: FormAction;
  answers?: Record<string, string | string[]>;
  result?: Record<string, unknown>;
}

export interface ProgressUpdate {
  step: number;
  total: number;
  answers: Record<string, string | string[]>;
}

/**
 * Get interaction ID from environment
 */
export function getInteractionId(): string | undefined {
  return process.env[ENV_INTERACTION_ID];
}

/**
 * Get result file path from environment or derive from ID
 */
export function getResultFileFromEnv(): string | undefined {
  const fromEnv = process.env[ENV_RESULT_FILE];
  if (fromEnv) return fromEnv;

  const id = getInteractionId();
  if (id) return getResultFilePath(id);

  return undefined;
}

/**
 * Get progress file path from environment or derive from ID
 */
export function getProgressFileFromEnv(): string | undefined {
  const fromEnv = process.env[ENV_PROGRESS_FILE];
  if (fromEnv) return fromEnv;

  const id = getInteractionId();
  if (id) return getProgressFilePath(id);

  return undefined;
}

/**
 * Emit result to file (primary) and stdout (fallback)
 * When running via InteractionManager (env vars set), only write to file
 */
export function emitResult(result: FormResult): void {
  const resultFile = getResultFileFromEnv();
  if (resultFile) {
    writeFileSync(resultFile, JSON.stringify(result), "utf-8");
    // Don't spam stdout when file is available
    return;
  }
  // Fallback: emit to stdout
  console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
}

/**
 * Emit progress update to file (append)
 * Only writes to file when env vars set - no stdout spam
 */
export function emitProgress(update: ProgressUpdate): void {
  const progressFile = getProgressFileFromEnv();
  if (progressFile) {
    appendFileSync(progressFile, JSON.stringify(update) + "\n", "utf-8");
  }
  // No stdout for progress - too noisy
}

/**
 * Build environment variables for running an interaction command
 */
export function buildInteractionEnv(interactionId: string): Record<string, string> {
  return {
    [ENV_INTERACTION_ID]: interactionId,
    [ENV_RESULT_FILE]: getResultFilePath(interactionId),
    [ENV_PROGRESS_FILE]: getProgressFilePath(interactionId),
  };
}
