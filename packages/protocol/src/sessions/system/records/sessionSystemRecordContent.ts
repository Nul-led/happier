import {
  StrictSessionStoredMessageContentEnvelopeSchema,
  type StrictSessionStoredMessageContentEnvelope,
} from '../../messages/sessionStoredMessageContent.js';

export const SessionSystemRecordContentSchema = StrictSessionStoredMessageContentEnvelopeSchema;
export type SessionSystemRecordContent = StrictSessionStoredMessageContentEnvelope;
