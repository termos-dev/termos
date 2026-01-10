import { z } from "zod";

/**
 * Zod schemas for form validation - source of truth
 */

export const FormOptionSchema = z.object({
  label: z.string().min(1, "Option label is required"),
  description: z.string().optional(),
});

export const FormQuestionSchema = z.object({
  question: z.string().min(1, "Question text is required"),
  header: z.string().min(1, "Header is required (used as answer key)"),
  options: z.array(FormOptionSchema).optional(),
  multiSelect: z.boolean().optional(),
  inputType: z.enum(["text", "textarea", "password"]).optional(),
  placeholder: z.string().optional(),
  validation: z.string().optional(),
}).refine(
  (q) => q.options || !q.multiSelect,
  { message: "multiSelect requires options to be defined" }
);

export const FormSchemaSchema = z.object({
  questions: z.array(FormQuestionSchema).min(1, "At least one question is required"),
});

/**
 * TypeScript types derived from zod schemas
 */
export type FormOption = z.infer<typeof FormOptionSchema>;
export type FormQuestion = z.infer<typeof FormQuestionSchema>;
export type FormSchema = z.infer<typeof FormSchemaSchema>;

/**
 * Validate and parse schema input, returns parsed schema or throws with helpful error
 */
export function parseFormSchema(input: unknown): FormSchema {
  // Handle array passed directly (common mistake)
  if (Array.isArray(input)) {
    throw new Error(
      "Schema must be an object with a 'questions' array, not an array directly.\n" +
      "Expected: {\"questions\": [...]}\n" +
      "Got: [...]"
    );
  }

  const result = FormSchemaSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `  - ${path}${issue.message}`;
    }).join("\n");
    throw new Error(`Invalid schema:\n${issues}\n\nRun with --help for expected format.`);
  }
  return result.data;
}

/**
 * Get human-readable schema format for --help
 */
export function getSchemaHelp(): string {
  return `
Schema Format:
  {
    "questions": [
      {
        "question": "What is your name?",      // required: the question text
        "header": "name",                       // required: key for the answer
        "inputType": "text",                    // optional: text | textarea | password
        "placeholder": "Enter name",            // optional: placeholder text
        "validation": "^[a-zA-Z]+$"             // optional: regex pattern
      },
      {
        "question": "Select your role",
        "header": "role",
        "options": [                            // required for select: choices
          { "label": "Developer", "description": "Write code" },
          { "label": "Designer" }
        ],
        "multiSelect": false                    // optional: true for checkboxes
      }
    ]
  }

Input Methods:
  --schema '<json>'     Pass JSON directly (escape quotes carefully)
  cat file.json | ...   Pipe JSON via stdin (recommended for complex schemas)
`.trim();
}
