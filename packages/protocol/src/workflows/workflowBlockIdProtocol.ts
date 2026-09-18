import { defineProtocolString } from '../plugins/actions/protocolComposableSchema.js';

/**
 * Authored block identity. `$` is deliberately excluded so the private runtime
 * root frame (`$root`) can never collide with an authored id. The grammar has
 * no length ceiling: workflow admission does not invent a quota for otherwise
 * valid definitions.
 */
export const WorkflowBlockIdProtocolSchema = defineProtocolString({
  pattern: '^[A-Za-z][A-Za-z0-9_-]*$(?![\\s\\S])',
});

export type WorkflowBlockId = ReturnType<typeof WorkflowBlockIdProtocolSchema.parse>;
