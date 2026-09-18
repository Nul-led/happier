import {
  SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1,
  serializeCanonicalJsonForSessionMutationEqualityV1,
} from '../mutations/sessionMutationEqualityV1.js';
import {
  SessionDiscussionMessageContentV1Schema,
  SessionDiscussionTitleV1Schema,
  type SessionDiscussionMessageContentV1,
  type SessionDiscussionTitleV1,
} from './content.js';

export { SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1 };

export type SessionDiscussionPostEqualityIntentV1 = Readonly<{
  content: SessionDiscussionMessageContentV1;
  mentionedAccountIds: readonly string[];
}>;

export type SessionDiscussionCreateEqualityIntentV1 = Readonly<{
  title: SessionDiscussionTitleV1;
  firstMessage: SessionDiscussionPostEqualityIntentV1 & Readonly<{ localId: string }>;
}>;

function normalizeMentionedAccountIds(mentionedAccountIds: readonly string[]): string[] {
  return Array.from(new Set(mentionedAccountIds)).sort();
}

/**
 * The one canonical equality input for discussion create/post. Callers never
 * construct their own JSON or HMAC input order, and the discriminator is part
 * of the bytes so a create intent can never equal a post intent.
 *
 * The intent covers the normalized semantic request only. Randomized E2EE
 * ciphertext is deliberately excluded: it differs on every attempt and would
 * make a retried request look like a new one.
 */
export function serializeSessionDiscussionMutationEqualityIntentV1(
  params:
    | Readonly<{ kind: 'create' }> & SessionDiscussionCreateEqualityIntentV1
    | Readonly<{ kind: 'post' }> & SessionDiscussionPostEqualityIntentV1,
): string {
  if (params.kind === 'create') {
    const title = SessionDiscussionTitleV1Schema.parse(params.title);
    const content = SessionDiscussionMessageContentV1Schema.parse(params.firstMessage.content);
    return serializeCanonicalJsonForSessionMutationEqualityV1({
      v: 1,
      kind: 'create',
      title,
      firstMessage: {
        localId: params.firstMessage.localId,
        content,
        mentionedAccountIds: normalizeMentionedAccountIds(params.firstMessage.mentionedAccountIds),
      },
    });
  }
  const content = SessionDiscussionMessageContentV1Schema.parse(params.content);
  return serializeCanonicalJsonForSessionMutationEqualityV1({
    v: 1,
    kind: 'post',
    content,
    mentionedAccountIds: normalizeMentionedAccountIds(params.mentionedAccountIds),
  });
}
