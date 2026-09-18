import {
  defineProtocolObject,
  defineProtocolString,
} from '../src/plugins/actions/protocolComposableSchema.js';
import { createSessionDraftAuthoringFieldsSchema } from '../src/drafts/sessionDrafts.js';
import { SyncedSessionAuthoringValueV1Schema } from '../src/sessions/authoring/index.js';

export const DeclarationPortableStringSchema = defineProtocolString({
  minLength: 1,
  maxLength: 64,
});

export const DeclarationPortableNestedSchema = defineProtocolObject({
  id: DeclarationPortableStringSchema,
  label: defineProtocolString({ maxLength: 128 }),
}, { policy: 'closed' });

export const DeclarationPortableSessionDraftAuthoringFieldsSchema =
  createSessionDraftAuthoringFieldsSchema(SyncedSessionAuthoringValueV1Schema);
