import type { FormSchema, FormQuestion, FormOption } from "./schema.js";

interface RawQuestion {
  question?: string;
  prompt?: string;
  header?: string;
  options?: unknown[];
  choices?: unknown[];
  placeholder?: string;
  default?: string;
  [key: string]: unknown;
}

/**
 * Normalize various input formats to standard FormSchema.
 * Handles:
 * - Array of questions directly
 * - Object with question:header mapping
 * - { questions: [...] } format
 * - Field aliases (prompt -> question, choices -> options, default -> placeholder)
 * - Auto-generates unique headers from question text
 */
export function normalizeFormSchema(input: unknown): FormSchema {
  // Handle array input
  if (Array.isArray(input)) {
    return normalizeFormSchema({ questions: input });
  }

  // Handle object-to-questions mapping (e.g., { "What is your name?": "name" })
  if (input && typeof input === "object" && !("questions" in input)) {
    const entries = Object.entries(input as Record<string, unknown>);
    const questions = entries.map(([question, value]) => {
      if (typeof value === "string") {
        return { question, header: value };
      }
      if (value && typeof value === "object") {
        return { question, ...value };
      }
      return { question };
    });
    return normalizeFormSchema({ questions });
  }

  // Process questions array
  const base = input as { questions?: RawQuestion[] };
  if (!Array.isArray(base.questions)) {
    return input as FormSchema;
  }

  const usedHeaders = new Set<string>();
  const questions = base.questions.map((q, idx) =>
    normalizeQuestion(q, idx, usedHeaders)
  );

  return { ...base, questions } as FormSchema;
}

function normalizeQuestion(
  q: RawQuestion,
  idx: number,
  usedHeaders: Set<string>
): FormQuestion {
  const result: Record<string, unknown> = { ...q };

  // Alias normalization: prompt -> question
  if (!result.question && typeof q.prompt === "string") {
    result.question = q.prompt;
  }

  // Alias normalization: choices -> options
  if (!result.options && Array.isArray(q.choices)) {
    result.options = q.choices;
  }

  // Alias normalization: default -> placeholder
  if (!result.placeholder && typeof q.default === "string") {
    result.placeholder = q.default;
  }

  // Auto-generate unique header
  result.header = generateUniqueHeader(
    (result.question as string) || "",
    result.header as string | undefined,
    idx,
    usedHeaders
  );

  // Normalize options format
  if (Array.isArray(result.options)) {
    result.options = (result.options as unknown[]).map(normalizeOption);
  }

  return result as FormQuestion;
}

function generateUniqueHeader(
  question: string,
  existingHeader: string | undefined,
  idx: number,
  used: Set<string>
): string {
  let header = existingHeader || slugify(question) || `q${idx + 1}`;
  let unique = header;
  let counter = 2;
  while (used.has(unique)) {
    unique = `${header}_${counter++}`;
  }
  used.add(unique);
  return unique;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeOption(opt: unknown): FormOption {
  if (typeof opt === "string" || typeof opt === "number") {
    return { label: String(opt) };
  }
  if (opt && typeof opt === "object" && "label" in opt) {
    const o = opt as { label?: unknown };
    return { ...opt, label: String(o.label ?? "") } as FormOption;
  }
  return { label: String(opt) };
}
