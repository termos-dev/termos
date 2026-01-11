import { appendFileSync } from "fs";

const ENV_INTERACTION_ID = "MCP_INTERACTION_ID";
const ENV_EVENTS_FILE = "MCP_EVENTS_FILE";

export type FormAction = "accept" | "decline" | "cancel" | "timeout";

export interface FormResult {
  action: FormAction;
  answers?: Record<string, string | string[]>;
  result?: unknown;
}

/**
 * Emit result to events file (reads from env vars set by InteractionManager)
 */
export function emitResult(result: FormResult): void {
  const eventsFile = process.env[ENV_EVENTS_FILE];
  const id = process.env[ENV_INTERACTION_ID];

  if (eventsFile && id) {
    const event = {
      ts: Date.now(),
      type: "result",
      id,
      action: result.action,
      ...(result.answers && { answers: result.answers }),
      ...(result.result !== undefined && { result: result.result }),
    };
    appendFileSync(eventsFile, JSON.stringify(event) + "\n");
  }
}

/**
 * Build environment variables for running an interaction command
 */
export function buildInteractionEnv(interactionId: string, eventsFile: string): Record<string, string> {
  return {
    [ENV_INTERACTION_ID]: interactionId,
    [ENV_EVENTS_FILE]: eventsFile,
  };
}
