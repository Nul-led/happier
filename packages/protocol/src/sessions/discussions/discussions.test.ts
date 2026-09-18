import { describe, expect, it } from 'vitest';

import {
  SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1,
  SESSION_INPUT_EQUALITY_HKDF_LABEL_V1,
  deriveSessionMutationEqualityTagV1,
} from '../mutations/sessionMutationEqualityV1.js';
import {
  SESSION_DISCUSSION_HTTP_PATHS_V1,
  SESSION_DISCUSSION_AGENT_POST_EVENT_V1,
  buildSessionDiscussionMutationRequestBodyV1,
  SessionDiscussionAgentPostRequestV1Schema,
  SessionDiscussionAgentPostResponseV1Schema,
  SessionDiscussionCreateRequestV1Schema,
  SessionDiscussionMessagesQueryV1Schema,
  SessionDiscussionPostRequestV1Schema,
  SessionDiscussionPostResponseV1Schema,
  SessionDiscussionReadRequestV1Schema,
} from './api.js';
import {
  SessionDiscussionOpenedMessageV1Schema,
  SessionDiscussionOpenedSummaryV1Schema,
} from './actions.js';
import {
  SessionDiscussionMessageContentV1Schema,
  SessionDiscussionSelectionSourceV1Schema,
  SessionDiscussionTitleV1Schema,
} from './content.js';
import { serializeSessionDiscussionMutationEqualityIntentV1 } from './equality.js';
import {
  SESSION_DISCUSSION_RECENT_AUTHOR_AVATAR_STACK_V1,
  SessionDiscussionLatestMessageV1Schema,
  SessionDiscussionSummaryV1Schema,
} from './models.js';

const plainMessage = {
  localId: 'local-1',
  content: { t: 'plain' as const, v: { v: 1, parts: [{ t: 'text', text: 'Ship it' }] } },
  mentionedAccountIds: [] as string[],
};

describe('session discussion content', () => {
  it('requires at least one mention or non-blank text run', () => {
    expect(SessionDiscussionMessageContentV1Schema.safeParse({
      v: 1,
      parts: [{ t: 'text', text: '   ' }],
    }).success).toBe(false);
    expect(SessionDiscussionMessageContentV1Schema.safeParse({
      v: 1,
      parts: [{ t: 'mention', accountId: 'acct-1' }],
    }).success).toBe(true);
  });

  it('rejects adjacent and leading empty text parts', () => {
    expect(SessionDiscussionMessageContentV1Schema.safeParse({
      v: 1,
      parts: [{ t: 'text', text: '' }, { t: 'mention', accountId: 'acct-1' }],
    }).success).toBe(false);
    expect(SessionDiscussionMessageContentV1Schema.safeParse({
      v: 1,
      parts: [
        { t: 'text', text: 'hi ' },
        { t: 'mention', accountId: 'acct-1' },
        { t: 'text', text: '' },
      ],
    }).success).toBe(true);
  });

  it('requires NFC normalization and rejects unknown fields', () => {
    expect(SessionDiscussionTitleV1Schema.safeParse({ v: 1, title: 'é' }).success).toBe(false);
    expect(SessionDiscussionTitleV1Schema.safeParse({ v: 1, title: 'é' }).success).toBe(true);
    expect(SessionDiscussionTitleV1Schema.safeParse({ v: 1, title: 'ok', extra: 1 }).success).toBe(false);
  });

  it('keeps selection provenance bounded, nonempty and deduplicated', () => {
    expect(SessionDiscussionSelectionSourceV1Schema.safeParse({
      kind: 'session_discussion',
      sessionId: 'sess-1',
      discussionId: 'disc-1',
      messageIds: [],
    }).success).toBe(false);
    expect(SessionDiscussionSelectionSourceV1Schema.safeParse({
      kind: 'session_discussion',
      sessionId: 'sess-1',
      discussionId: 'disc-1',
      messageIds: ['m1', 'm1'],
    }).success).toBe(false);
    expect(SessionDiscussionSelectionSourceV1Schema.safeParse({
      kind: 'session_discussion',
      sessionId: 'sess-1',
      discussionId: 'disc-1',
      messageIds: ['m1', 'm2'],
      draftCorrelationId: 'corr-1',
    }).success).toBe(true);
  });
});

describe('session discussion presentation projections', () => {
  const summary = {
    id: 'discussion-1',
    sessionId: 'session-1',
    creationLocalId: null,
    titleContent: { t: 'plain' as const, v: { v: 1, title: 'Design review' } },
    latestMessage: {
      id: 'message-1',
      localId: null,
      seq: 4,
      authorAccountId: 'account-4',
      accountActor: null,
      producerV1: null,
      createdAt: 1,
    },
    messageSeq: 4,
    lastReadSeq: null,
    unreadCount: 0,
    unreadMentionCount: 0,
    archivedAt: null,
    capabilities: {
      postMessages: true,
      rename: true,
      archive: true,
      restore: false,
      askAgent: true,
      sendToSession: true,
    },
  };

  it('enforces the one three-avatar recent-author projection bound', () => {
    const { titleContent: _titleContent, ...openedSummary } = summary;
    expect(SESSION_DISCUSSION_RECENT_AUTHOR_AVATAR_STACK_V1).toBe(3);
    expect(SessionDiscussionSummaryV1Schema.safeParse({
      ...summary,
      recentAuthorAccountIds: ['account-1', 'account-2', 'account-3'],
    }).success).toBe(true);
    expect(SessionDiscussionSummaryV1Schema.safeParse({
      ...summary,
      recentAuthorAccountIds: ['account-1', 'account-2', 'account-3', 'account-4'],
    }).success).toBe(false);
    expect(SessionDiscussionOpenedSummaryV1Schema.safeParse({
      ...openedSummary,
      title: 'Design review',
      recentAuthorAccountIds: ['account-1', 'account-2', 'account-3', 'account-4'],
    }).success).toBe(false);
  });
});

describe('session discussion API schemas', () => {
  it('owns the complete HTTP path set', () => {
    expect(SESSION_DISCUSSION_HTTP_PATHS_V1).toEqual({
      collection: '/v2/sessions/:sessionId/discussions',
      discussion: '/v2/sessions/:sessionId/discussions/:discussionId',
      archive: '/v2/sessions/:sessionId/discussions/:discussionId/archive',
      restore: '/v2/sessions/:sessionId/discussions/:discussionId/restore',
      messages: '/v2/sessions/:sessionId/discussions/:discussionId/messages',
      read: '/v2/sessions/:sessionId/discussions/:discussionId/read',
    });
  });

  it('builds the exact final create, post, and rename mutation bodies', () => {
    const e2eeEvidence = { kind: 'e2eeTag' as const, tag: 'A'.repeat(43) };
    const create = buildSessionDiscussionMutationRequestBodyV1({
      kind: 'create',
      creationLocalId: 'creation-1',
      creationEqualityEvidenceV1: e2eeEvidence,
      titleContent: { t: 'encrypted', c: 'title-ciphertext' },
      firstMessage: {
        localId: 'message-1',
        requestEqualityEvidenceV1: e2eeEvidence,
        content: { t: 'encrypted', c: 'message-ciphertext' },
        mentionedAccountIds: ['account-1'],
      },
    });
    const post = buildSessionDiscussionMutationRequestBodyV1({
      kind: 'post',
      localId: 'message-2',
      requestEqualityEvidenceV1: e2eeEvidence,
      content: { t: 'encrypted', c: 'post-ciphertext' },
      mentionedAccountIds: ['account-2'],
    });
    const rename = buildSessionDiscussionMutationRequestBodyV1({
      kind: 'rename',
      titleContent: { t: 'plain', v: { v: 1, title: 'Renamed' } },
    });

    expect(create).toEqual({
      creationLocalId: 'creation-1',
      creationEqualityEvidenceV1: e2eeEvidence,
      titleContent: { t: 'encrypted', c: 'title-ciphertext' },
      firstMessage: {
        localId: 'message-1',
        requestEqualityEvidenceV1: e2eeEvidence,
        content: { t: 'encrypted', c: 'message-ciphertext' },
        mentionedAccountIds: ['account-1'],
      },
    });
    expect(create.creationLocalId).not.toBe(create.firstMessage.localId);
    expect(post).toEqual({
      localId: 'message-2',
      requestEqualityEvidenceV1: e2eeEvidence,
      content: { t: 'encrypted', c: 'post-ciphertext' },
      mentionedAccountIds: ['account-2'],
    });
    expect(rename).toEqual({ titleContent: { t: 'plain', v: { v: 1, title: 'Renamed' } } });
  });

  it('does not generate identities or accept misplaced equality evidence', () => {
    expect(() => buildSessionDiscussionMutationRequestBodyV1({
      kind: 'create',
      creationLocalId: undefined as unknown as string,
      titleContent: { t: 'plain', v: { v: 1, title: 'Title' } },
      firstMessage: {
        localId: 'message-1',
        content: { t: 'plain', v: { v: 1, parts: [{ t: 'text', text: 'Hello' }] } },
        mentionedAccountIds: [],
      },
    })).toThrow();
    expect(() => buildSessionDiscussionMutationRequestBodyV1({
      kind: 'post',
      localId: 'message-2',
      content: { t: 'encrypted', c: 'ciphertext' },
      mentionedAccountIds: [],
      requestEqualityEvidenceV1: undefined,
    })).toThrow();
  });

  it('keeps discussion creation and first-message retry identities distinct', () => {
    const aliased = {
      creationLocalId: 'same-local-id',
      titleContent: { t: 'plain' as const, v: { v: 1, title: 'Title' } },
      firstMessage: {
        localId: 'same-local-id',
        content: { t: 'plain' as const, v: { v: 1, parts: [{ t: 'text' as const, text: 'Hello' }] } },
        mentionedAccountIds: [],
      },
    };

    expect(SessionDiscussionCreateRequestV1Schema.safeParse(aliased).success).toBe(false);
    expect(() => buildSessionDiscussionMutationRequestBodyV1({
      kind: 'create',
      ...aliased,
    })).toThrow();
  });

  it('requires e2eeTag equality for encrypted content and refuses a client plain digest', () => {
    expect(SessionDiscussionPostRequestV1Schema.safeParse({
      ...plainMessage,
      content: { t: 'encrypted', c: 'Y2lwaGVy' },
    }).success).toBe(false);
    expect(SessionDiscussionPostRequestV1Schema.safeParse({
      ...plainMessage,
      content: { t: 'encrypted', c: 'Y2lwaGVy' },
      requestEqualityEvidenceV1: { kind: 'e2eeTag', tag: 'A'.repeat(43) },
    }).success).toBe(true);
    expect(SessionDiscussionPostRequestV1Schema.safeParse({
      ...plainMessage,
      requestEqualityEvidenceV1: { kind: 'plainDigest', digest: 'A'.repeat(43) },
    }).success).toBe(false);
    expect(SessionDiscussionPostRequestV1Schema.safeParse(plainMessage).success).toBe(true);
  });

  it('rejects caller-authored producer provenance on the public post request', () => {
    expect(SessionDiscussionPostRequestV1Schema.safeParse({
      ...plainMessage,
      producerV1: {
        v: 1,
        kind: 'agent',
        runId: 'run-forged-by-caller',
      },
    }).success).toBe(false);
  });

  it('keeps the runtime Agent-post carrier producer-free and Session-bound', () => {
    expect(SESSION_DISCUSSION_AGENT_POST_EVENT_V1).toBe('session-discussion-agent-post-v1');
    const request = {
      v: 1,
      sessionId: 'session-1',
      discussionId: 'discussion-1',
      request: plainMessage,
      runId: 'run-1',
      toolCallId: 'tool-1',
    };
    expect(SessionDiscussionAgentPostRequestV1Schema.safeParse(request).success).toBe(true);
    expect(SessionDiscussionAgentPostRequestV1Schema.safeParse({
      ...request,
      producerV1: { v: 1, kind: 'agent', sessionId: 'session-2' },
    }).success).toBe(false);
  });

  it('initializes the ordinary post response before the Agent carrier wraps it', () => {
    const message = {
      id: 'message-1',
      discussionId: 'discussion-1',
      localId: null,
      seq: 1,
      authorAccountId: 'account-1',
      accountActor: { v: 1, accountId: 'account-1', profile: null },
      producerV1: null,
      content: plainMessage.content,
      mentionedAccountIds: [],
      createdAt: 1,
    };
    const value = SessionDiscussionPostResponseV1Schema.parse({
      message,
      messageSeq: 1,
    });

    expect(SessionDiscussionPostResponseV1Schema.safeParse({
      message: { ...message, accountActor: undefined },
      messageSeq: 1,
    }).success).toBe(false);
    expect(SessionDiscussionPostResponseV1Schema.safeParse({
      message: {
        ...message,
        accountActor: { v: 1, accountId: 'account-1', profile: null, email: 'private@example.test' },
      },
      messageSeq: 1,
    }).success).toBe(false);
    expect(SessionDiscussionPostResponseV1Schema.safeParse({
      message: {
        ...message,
        accountActor: { v: 1, accountId: 'different-account', profile: null },
      },
      messageSeq: 1,
    }).success).toBe(false);

    expect(SessionDiscussionLatestMessageV1Schema.safeParse({
      id: 'message-1',
      localId: null,
      seq: 1,
      authorAccountId: 'account-1',
      accountActor: { v: 1, accountId: 'different-account', profile: null },
      producerV1: null,
      createdAt: 1,
    }).success).toBe(false);
    expect(SessionDiscussionOpenedMessageV1Schema.safeParse({
      ...message,
      content: plainMessage.content.v,
      accountActor: { v: 1, accountId: 'different-account', profile: null },
    }).success).toBe(false);

    expect(SessionDiscussionAgentPostResponseV1Schema.parse({
      ok: true,
      v: 1,
      value,
    })).toEqual({ ok: true, v: 1, value });
  });

  it('rejects a create whose title and first message disagree about storage mode', () => {
    expect(SessionDiscussionCreateRequestV1Schema.safeParse({
      creationLocalId: 'create-1',
      titleContent: { t: 'plain', v: { v: 1, title: 'Release readiness' } },
      firstMessage: {
        ...plainMessage,
        content: { t: 'encrypted', c: 'Y2lwaGVy' },
        requestEqualityEvidenceV1: { kind: 'e2eeTag', tag: 'A'.repeat(43) },
      },
    }).success).toBe(false);
  });

  it('rejects mutually exclusive message pagination and negative cursors', () => {
    expect(SessionDiscussionMessagesQueryV1Schema.safeParse({ beforeSeq: 5, afterSeq: 2 }).success).toBe(false);
    expect(SessionDiscussionMessagesQueryV1Schema.safeParse({ afterSeq: 2 }).success).toBe(true);
    expect(SessionDiscussionReadRequestV1Schema.safeParse({ lastReadSeq: -1 }).success).toBe(false);
    expect(SessionDiscussionReadRequestV1Schema.safeParse({ lastReadSeq: 1.5 }).success).toBe(false);
  });
});

describe('session discussion mutation equality', () => {
  const title = { v: 1 as const, title: 'Release readiness' };
  const content = { v: 1 as const, parts: [{ t: 'text' as const, text: 'Ship it' }] };

  it('is independent of key order and mention order but not of the operation', () => {
    const left = serializeSessionDiscussionMutationEqualityIntentV1({
      kind: 'post',
      content,
      mentionedAccountIds: ['b', 'a'],
    });
    const right = serializeSessionDiscussionMutationEqualityIntentV1({
      kind: 'post',
      mentionedAccountIds: ['a', 'b', 'a'],
      content: { parts: [{ text: 'Ship it', t: 'text' }], v: 1 } as typeof content,
    });
    const create = serializeSessionDiscussionMutationEqualityIntentV1({
      kind: 'create',
      title,
      firstMessage: { localId: 'local-1', content, mentionedAccountIds: ['a', 'b'] },
    });

    expect(left).toBe(right);
    expect(create).not.toBe(left);
    expect(create.includes('"kind":"create"')).toBe(true);
  });

  it('separates discussion tags from Session-input tags for the same Session key', () => {
    const keyMaterial = new Uint8Array(32).fill(7);
    const canonicalIntent = serializeSessionDiscussionMutationEqualityIntentV1({
      kind: 'post',
      content,
      mentionedAccountIds: [],
    });
    const discussionTag = deriveSessionMutationEqualityTagV1({
      keyMaterial,
      sessionId: 'sess-1',
      purpose: SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1,
      canonicalIntent,
    });
    const inputTag = deriveSessionMutationEqualityTagV1({
      keyMaterial,
      sessionId: 'sess-1',
      purpose: SESSION_INPUT_EQUALITY_HKDF_LABEL_V1,
      canonicalIntent,
    });
    const otherSessionTag = deriveSessionMutationEqualityTagV1({
      keyMaterial,
      sessionId: 'sess-2',
      purpose: SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1,
      canonicalIntent,
    });

    expect(discussionTag).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(discussionTag).not.toBe(inputTag);
    expect(discussionTag).not.toBe(otherSessionTag);
  });

  it('refuses to derive a tag without Session key material', () => {
    expect(() => deriveSessionMutationEqualityTagV1({
      keyMaterial: new Uint8Array(0),
      sessionId: 'sess-1',
      purpose: SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1,
      canonicalIntent: 'x',
    })).toThrow('Session key material');
  });
});
