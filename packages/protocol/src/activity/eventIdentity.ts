import type { SessionDiscussionId } from '../sessions/idsV1.js';

/**
 * Canonical committed sequence reference for one Session Activity event.
 *
 * The sequence owner is part of the identity because the main transcript and
 * every Discussion allocate independent sequence numbers.
 */
export type ActivitySequenceEventReferenceV1 =
  | Readonly<{
      sequenceDomain: 'session_transcript';
      sequence: number;
    }>
  | Readonly<{
      sequenceDomain: 'discussion';
      discussionId: SessionDiscussionId;
      sequence: number;
    }>;

/** Stable device-local identity shared by every leg observing the event. */
export function resolveActivitySequenceEventIdentityV1(
  reference: ActivitySequenceEventReferenceV1,
): string {
  return reference.sequenceDomain === 'discussion'
    ? `message-seq:discussion:${reference.discussionId}:${reference.sequence}`
    : `message-seq:session_transcript:${reference.sequence}`;
}

/**
 * Reader-compatible identity for the released V1 remote-alert shape.
 *
 * V1 did not identify the sequence owner, so it must remain distinct from the
 * canonical current identity rather than suppressing a potentially different
 * transcript or Discussion event.
 */
export function resolveLegacyActivitySequenceEventIdentityV1(sequence: number): string {
  return `legacy-message-seq:${sequence}`;
}

/** Stable identity for committed turn-scoped Activity events. */
export function resolveActivityTurnEventIdentityV1(turnId: string): string {
  return `turn:${turnId}`;
}
