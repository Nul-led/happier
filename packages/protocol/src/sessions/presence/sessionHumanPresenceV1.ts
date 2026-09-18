import { z } from 'zod';
import { asProtocolZod } from '../../plugins/actions/internalProtocolZodAdapter.js';
import { SessionIdSchema } from '../idsV1.js';
import { SessionAccessAccountSummaryV1Schema } from '../access/sessionAccessPrincipalV1.js';

export const SESSION_HUMAN_PRESENCE_VISIBLE_REPLACE_EVENT = 'session-human-presence:visible-replace';
export const SESSION_HUMAN_PRESENCE_TYPING_SET_EVENT = 'session-human-presence:typing-set';
export const SESSION_HUMAN_PRESENCE_SNAPSHOT_EVENT = 'session-human-presence:snapshot';

// V1 is a closed operation epoch, independently negotiated by its first actual
// declaration. Unknown identity/routing/profile fields are never dropped.
const normalizedSessionId = z.string().trim().pipe(asProtocolZod(SessionIdSchema));
const sessionIds = z.array(normalizedSessionId).transform(ids => [...new Set(ids)].sort());
const normalizedDiscussionId = z.string().trim().pipe(asProtocolZod(SessionIdSchema));

export const SessionHumanPresenceLocationV1Schema = z.object({
  sessionId: normalizedSessionId,
  discussionId: normalizedDiscussionId,
}).strict();
export type SessionHumanPresenceLocationV1 = z.infer<typeof SessionHumanPresenceLocationV1Schema>;

const discussionLocations = z.array(SessionHumanPresenceLocationV1Schema).transform(locations => {
  const byKey = new Map(locations.map(location => [`${location.sessionId}\u0000${location.discussionId}`, location]));
  return [...byKey.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId)
    || left.discussionId.localeCompare(right.discussionId));
});

export const SessionHumanPresenceVisibleReplaceV1Schema = z.object({
  v: z.literal(1),
  // This is the complete finite rendered set. A count or byte limit here would
  // make an unrelated transport threshold part of collaboration semantics.
  sessionIds,
  // Optional keeps the released/current Session-only declaration byte-compatible.
  // An older strict server rejects this routing field instead of silently
  // treating discussion visibility as Session visibility.
  locations: discussionLocations.optional(),
}).strict();
export type SessionHumanPresenceVisibleReplaceV1 = z.infer<typeof SessionHumanPresenceVisibleReplaceV1Schema>;

export const SessionHumanPresenceVisibleReplaceResultV1Schema = z.discriminatedUnion('ok', [
  z.object({
    v: z.literal(1),
    ok: z.literal(true),
    admittedSessionIds: sessionIds,
    admittedLocations: discussionLocations.optional(),
  }).strict(),
  z.object({
    v: z.literal(1), ok: z.literal(false),
    errorCode: z.enum(['INVALID_REQUEST', 'UNSUPPORTED_VERSION', 'UNAVAILABLE']),
  }).strict(),
]);
export type SessionHumanPresenceVisibleReplaceResultV1 = z.infer<typeof SessionHumanPresenceVisibleReplaceResultV1Schema>;

export const SessionHumanPresenceTypingSetV1Schema = z.object({
  v: z.literal(1),
  sessionId: normalizedSessionId,
  discussionId: normalizedDiscussionId.optional(),
  typing: z.boolean(),
}).strict();
export type SessionHumanPresenceTypingSetV1 = z.infer<typeof SessionHumanPresenceTypingSetV1Schema>;

export const SessionHumanPresenceViewerV1Schema = z.object({
  account: SessionAccessAccountSummaryV1Schema,
  typing: z.boolean(),
}).strict();
export type SessionHumanPresenceViewerV1 = z.infer<typeof SessionHumanPresenceViewerV1Schema>;

export const SessionHumanPresenceSnapshotV1Schema = z.object({
  v: z.literal(1),
  sessionId: asProtocolZod(SessionIdSchema),
  discussionId: asProtocolZod(SessionIdSchema).optional(),
  observedAt: z.number().int().nonnegative().finite(),
  viewers: z.array(SessionHumanPresenceViewerV1Schema),
}).strict();
export type SessionHumanPresenceSnapshotV1 = z.infer<typeof SessionHumanPresenceSnapshotV1Schema>;
