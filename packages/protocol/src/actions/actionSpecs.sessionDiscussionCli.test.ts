import { describe, expect, it } from 'vitest';

import { getActionSpec, listActionCliCommandDeclarations } from './actionSpecs.js';
import { actionCliDerivedDefault } from './actionCliProjection.js';

describe('Session discussion friendly CLI projection', () => {
  it('publishes every user discussion intent under the canonical friendly path', () => {
    const byPath = new Map(
      listActionCliCommandDeclarations().map(({ spec, binding }) => [binding.path.join(' '), spec.id]),
    );

    expect([...byPath.entries()].filter(([path]) => path.startsWith('session discussions '))).toEqual([
      ['session discussions list', 'session.discussion.list'],
      ['session discussions show', 'session.discussion.get'],
      ['session discussions read', 'session.discussion.read'],
      ['session discussions create', 'session.discussion.create'],
      ['session discussions post', 'session.discussion.post'],
      ['session discussions rename', 'session.discussion.rename'],
      ['session discussions archive', 'session.discussion.archive'],
      ['session discussions restore', 'session.discussion.restore'],
      ['session discussions read-state', 'session.discussion.read_state.set'],
    ]);
    for (const actionId of byPath.values()) {
      if (!actionId.startsWith('session.discussion.')) continue;
      expect(getActionSpec(actionId).cli?.acceptsServerId, actionId).toBe(true);
    }
  });

  it('binds scalar create input to distinct durable identities and canonical message content', () => {
    const spec = getActionSpec('session.discussion.create');
    const caller = spec.cli?.inputSchema?.parse({
      sessionId: 'session-prefix',
      title: 'Release readiness',
      message: 'All provider migrations are green.',
      mentionedAccountIds: ['account-a', 'account-b'],
    });

    expect(spec.cli?.bindInput?.(caller, {
      actionId: spec.id,
      invocationId: 'invocation-1',
    })).toEqual({
      sessionId: 'session-prefix',
      creationLocalId: actionCliDerivedDefault('discussion-invocation-1'),
      title: 'Release readiness',
      firstMessage: {
        localId: 'message-invocation-1',
        content: { v: 1, parts: [{ t: 'text', text: 'All provider migrations are green.' }] },
        mentionedAccountIds: ['account-a', 'account-b'],
      },
    });
  });

  it('binds scalar post input while preserving an explicit retry identity', () => {
    const spec = getActionSpec('session.discussion.post');
    const caller = spec.cli?.inputSchema?.parse({
      sessionId: 'session-prefix',
      discussionId: 'discussion-1',
      message: 'Please review this.',
      mentionedAccountIds: ['account-a'],
      localId: 'retry-post-1',
    });

    expect(spec.cli?.bindInput?.(caller, {
      actionId: spec.id,
      invocationId: 'invocation-2',
    })).toEqual({
      sessionId: 'session-prefix',
      discussionId: 'discussion-1',
      localId: 'retry-post-1',
      content: { v: 1, parts: [{ t: 'text', text: 'Please review this.' }] },
      mentionedAccountIds: ['account-a'],
    });
  });

  it('normalizes authored CLI text at the Action binding before strict Discussion validation', () => {
    const create = getActionSpec('session.discussion.create');
    const createCaller = create.cli?.inputSchema?.parse({
      sessionId: 'session-prefix',
      title: 'Cafe\u0301 review',
      message: 'Re\u0301sume\u0301 findings',
    });
    expect(create.cli?.bindInput?.(createCaller, {
      actionId: create.id,
      invocationId: 'invocation-nfc',
    })).toEqual(expect.objectContaining({
      title: 'Café review',
      firstMessage: expect.objectContaining({
        content: { v: 1, parts: [{ t: 'text', text: 'Résumé findings' }] },
      }),
    }));

    const post = getActionSpec('session.discussion.post');
    const postCaller = post.cli?.inputSchema?.parse({
      sessionId: 'session-prefix',
      discussionId: 'discussion-1',
      message: 'Cafe\u0301 follow-up',
    });
    expect(post.cli?.bindInput?.(postCaller, {
      actionId: post.id,
      invocationId: 'invocation-post-nfc',
    })).toEqual(expect.objectContaining({
      content: { v: 1, parts: [{ t: 'text', text: 'Café follow-up' }] },
    }));

    const rename = getActionSpec('session.discussion.rename');
    const renameCaller = rename.cli?.inputSchema?.parse({
      sessionId: 'session-prefix',
      discussionId: 'discussion-1',
      title: 'Re\u0301sume\u0301 review',
    });
    expect(rename.cli?.bindInput?.(renameCaller, {
      actionId: rename.id,
      invocationId: 'invocation-rename-nfc',
    })).toEqual({
      sessionId: 'session-prefix',
      discussionId: 'discussion-1',
      title: 'Résumé review',
    });
  });

});
