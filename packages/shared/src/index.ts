// Schema validation
export {
  parseFormSchema,
  getSchemaHelp,
  type FormOption,
  type FormQuestion,
  type FormSchema,
} from "./schema.js";

// Protocol
export {
  emitResult,
  buildInteractionEnv,
  type FormAction,
  type FormResult,
} from "./protocol.js";

// Component schemas for CLI help generation
export {
  componentSchemas,
  globalOptionsSchema,
  POSITION_PRESETS,
  generateComponentHelp,
  generateFullHelp,
  type ArgSchema,
  type ComponentSchema,
} from "./component-schemas.js";
