import { z } from 'zod';

import { SessionStoredMessageContentSchema } from '../messages/sessionStoredMessageContent.js';
import { SessionMessageAccountActorV1Schema } from '../messages/sessionMessageAccountActorV1.js';
import { SessionMessageRoleSchema } from '../messages/sessionMessageRole.js';
import { SESSION_TRANSCRIPT_MAX_PAGE_ROWS_V1 } from '../messages/sessionTranscriptPageLimits.js';

export const SESSION_FOLLOW_SOURCE_PROJECTION_MAX_PAGE_ROWS_V1 = SESSION_TRANSCRIPT_MAX_PAGE_ROWS_V1;

export const SessionFollowSourceProjectionRequestV1Schema = z.object({
  v: z.literal(1),
  sourceSessionId: z.string().trim().min(1),
  afterTranscriptSeq: z.number().int().min(0),
  observedTranscriptSeq: z.number().int().min(0),
  limit: z.number().int().min(1).max(SESSION_FOLLOW_SOURCE_PROJECTION_MAX_PAGE_ROWS_V1),
}).strict().refine((value) => value.afterTranscriptSeq <= value.observedTranscriptSeq);

export const SessionFollowSourceProjectionV1Schema = z.object({
  id: z.string().trim().min(1),
  encryptionMode: z.enum(['plain', 'e2ee']),
  metadata: z.string().nullable(),
  metadataLayoutVersion: z.number().int().optional(),
  archivedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  active: z.boolean(),
  activeAt: z.number().int(),
  thinking: z.boolean(),
  thinkingAt: z.number().int().nullable(),
  latestTurnStatus: z.string().nullable(),
  latestTurnStatusObservedAt: z.number().int().nullable(),
  latestReadyEventSeq: z.number().int().nullable(),
  latestReadyEventAt: z.number().int().nullable(),
  meaningfulActivityAt: z.number().int().nullable(),
  agentStateVersion: z.number().int().min(0),
  pendingPermissionRequestCount: z.number().int().min(0).optional(),
  pendingUserActionRequestCount: z.number().int().min(0).optional(),
  pendingRequestObservedAt: z.number().int().nullable().optional(),
  pendingCount: z.number().int().min(0).optional(),
  pendingBlockedCount: z.number().int().min(0).optional(),
  runtimeActivityState: z.string().nullable().optional(),
  runtimeActivityActiveCount: z.number().int().min(0).optional(),
}).strict();

export const SessionFollowSourceProjectionMessageV1Schema = z.object({
  seq: z.number().int().min(0),
  content: SessionStoredMessageContentSchema,
  messageRole: SessionMessageRoleSchema.optional(),
  createdAt: z.number().int(),
  accountActor: SessionMessageAccountActorV1Schema.nullable().optional(),
}).strict();

export const SessionFollowSourceProjectionResponseV1Schema = z.object({
  v: z.literal(1),
  source: SessionFollowSourceProjectionV1Schema,
  messages: z.array(SessionFollowSourceProjectionMessageV1Schema).max(SESSION_FOLLOW_SOURCE_PROJECTION_MAX_PAGE_ROWS_V1),
  hasMore: z.boolean(),
}).strict();

export type SessionFollowSourceProjectionRequestV1 = z.infer<typeof SessionFollowSourceProjectionRequestV1Schema>;
export type SessionFollowSourceProjectionResponseV1 = z.infer<typeof SessionFollowSourceProjectionResponseV1Schema>;
