import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureConsoleJsonOutput, captureConsoleText } from '@/testkit/logger/captureOutput';
import { listCompiledActionCliCommands } from '@/cli/actions/compiledCommands';
import { resolveCompiledActionCliCompletionCandidates } from '@/cli/actions/commandCompletion';

const execute = vi.fn();
const resolveSessionTarget = vi.fn(async (selector: string) => ({
  ok: true as const,
  sessionId: selector === 'session-prefix' ? 'session-exact' : selector,
}));
const createCliActionExecutorFromCredentials = vi.fn(() => ({ execute, resolveSessionTarget }));

vi.mock('@/session/actions/createCliActionExecutorFromCredentials', () => ({
  createCliActionExecutorFromCredentials,
}));

import { handleSessionCommand } from './handleSessionCommand';

const credentials = {
  token: 'token_test',
  encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) },
};

const capabilities = {
  postMessages: true,
  rename: true,
  archive: true,
  restore: false,
  askAgent: true,
  sendToSession: true,
};

function summary() {
  return {
    id: 'discussion-1',
    sessionId: 'session-exact',
    creationLocalId: 'creation-1',
    title: 'Release readiness',
    latestMessage: {
      id: 'message-1',
      localId: 'local-1',
      seq: 1,
      authorAccountId: 'account-1',
      accountActor: { v: 1, accountId: 'account-1', profile: null },
      producerV1: null,
      createdAt: 1,
    },
    messageSeq: 1,
    lastReadSeq: 0,
    unreadCount: 1,
    unreadMentionCount: 0,
    recentAuthorAccountIds: ['account-1'],
    archivedAt: null,
    capabilities,
  };
}

function message() {
  return {
    id: 'message-1',
    discussionId: 'discussion-1',
    localId: 'local-1',
    seq: 1,
    authorAccountId: 'account-1',
    accountActor: { v: 1, accountId: 'account-1', profile: null },
    producerV1: null,
    content: { v: 1, parts: [{ t: 'text', text: 'All migrations are green.' }] },
    mentionedAccountIds: [],
    createdAt: 1,
  };
}

function resultFor(actionId: string) {
  const envelope = { v: 1, serverId: 'server-1', sessionId: 'session-exact' };
  switch (actionId) {
    case 'session.discussion.list':
      return { ...envelope, discussions: [summary()], nextCursor: null, incomplete: false };
    case 'session.discussion.get':
    case 'session.discussion.rename':
    case 'session.discussion.archive':
    case 'session.discussion.restore':
      return { ...envelope, discussion: summary() };
    case 'session.discussion.read':
      return {
        ...envelope,
        discussionId: 'discussion-1',
        messages: [message()],
        hasMoreOlder: false,
        messageSeq: 1,
        incomplete: false,
      };
    case 'session.discussion.create':
      return { ...envelope, discussion: summary(), firstMessage: message() };
    case 'session.discussion.post':
      return { ...envelope, message: message(), messageSeq: 1 };
    case 'session.discussion.read_state.set':
      return {
        ...envelope,
        cursor: { discussionId: 'discussion-1', lastReadSeq: 1, didChange: true },
      };
    default:
      throw new Error(`unexpected action ${actionId}`);
  }
}

describe('happier session discussions (compiled Action executor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    execute.mockImplementation(async (actionId: string) => ({ ok: true, result: resultFor(actionId) }));
  });

  it('routes every friendly discussion command through the canonical Action and exact Session resolver', async () => {
    const cases = [
      [['discussions', 'list', 'session-prefix'], 'session.discussion.list', 'session_discussions_list'],
      [['discussions', 'show', 'session-prefix', 'discussion-1'], 'session.discussion.get', 'session_discussions_show'],
      [['discussions', 'read', 'session-prefix', 'discussion-1'], 'session.discussion.read', 'session_discussions_read'],
      [['discussions', 'create', 'session-prefix', 'Release readiness', 'First post'], 'session.discussion.create', 'session_discussions_create'],
      [['discussions', 'post', 'session-prefix', 'discussion-1', 'Reply'], 'session.discussion.post', 'session_discussions_post'],
      [['discussions', 'rename', 'session-prefix', 'discussion-1', 'New title'], 'session.discussion.rename', 'session_discussions_rename'],
      [['discussions', 'archive', 'session-prefix', 'discussion-1'], 'session.discussion.archive', 'session_discussions_archive'],
      [['discussions', 'restore', 'session-prefix', 'discussion-1'], 'session.discussion.restore', 'session_discussions_restore'],
      [['discussions', 'read-state', 'session-prefix', 'discussion-1', '1'], 'session.discussion.read_state.set', 'session_discussions_read_state'],
    ] as const;
    for (const [argv, actionId, kind] of cases) {
      const output = captureConsoleJsonOutput();
      try {
        await handleSessionCommand([...argv, '--json'], { readCredentialsFn: async () => credentials });
        expect(output.json()).toMatchObject({ v: 1, ok: true, kind });
      } finally {
        output.restore();
      }
      expect(execute.mock.calls.at(-1)?.[0], argv.join(' ')).toBe(actionId);
      expect(execute.mock.calls.at(-1)?.[1], argv.join(' ')).toMatchObject({ sessionId: 'session-exact' });
    }

    expect(resolveSessionTarget).toHaveBeenCalledTimes(cases.length);
    expect(createCliActionExecutorFromCredentials).toHaveBeenCalledTimes(cases.length);
  }, 60_000);

  it('binds authored text, repeated mentions, and caller retry identities before invoking create/post', async () => {
    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand([
        'discussions', 'create', 'session-prefix', 'Title', 'Hello',
        '--mentioned-account-ids', 'account-a',
        '--mentioned-account-ids', 'account-b',
        '--creation-local-id', 'creation-retry',
        '--message-local-id', 'message-retry',
        '--json',
      ], { readCredentialsFn: async () => credentials });
      expect(output.json()).toMatchObject({ ok: true, kind: 'session_discussions_create' });
    } finally {
      output.restore();
    }
    expect(execute).toHaveBeenLastCalledWith(
      'session.discussion.create',
      {
        sessionId: 'session-exact',
        creationLocalId: 'creation-retry',
        title: 'Title',
        firstMessage: {
          localId: 'message-retry',
          content: { v: 1, parts: [{ t: 'text', text: 'Hello' }] },
          mentionedAccountIds: ['account-a', 'account-b'],
        },
      },
      {
        surface: 'cli',
        defaultSessionId: 'session-exact',
        actionRequestId: expect.any(String),
      },
    );
  });

  it('returns the durable identities on outcome-unknown so a mutation can be reconciled safely', async () => {
    execute.mockResolvedValueOnce({ ok: false, errorCode: 'outcome_unknown' });
    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand([
        'discussions', 'create', 'session-prefix', 'Title', 'Hello',
        '--creation-local-id', 'creation-retry',
        '--message-local-id', 'message-retry',
        '--json',
      ], { readCredentialsFn: async () => credentials });
      expect(output.json()).toEqual({
        v: 1,
        ok: false,
        kind: 'session_discussions_create',
        error: {
          code: 'outcome_unknown',
          creationLocalId: 'creation-retry',
          messageLocalId: 'message-retry',
        },
      });
    } finally {
      output.restore();
      process.exitCode = 0;
    }
  });

  it('preserves cancellation as a typed failure without losing the post retry identity', async () => {
    execute.mockResolvedValueOnce({ ok: false, errorCode: 'cancelled' });
    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand([
        'discussions', 'post', 'session-prefix', 'discussion-1', 'Hello',
        '--local-id', 'post-retry',
        '--json',
      ], { readCredentialsFn: async () => credentials });
      expect(output.json()).toEqual({
        v: 1,
        ok: false,
        kind: 'session_discussions_post',
        error: { code: 'cancelled', localId: 'post-retry' },
      });
    } finally {
      output.restore();
      process.exitCode = 0;
    }
  });

  it('presents opened discussion content in human mode instead of dumping a transport object', async () => {
    const output = captureConsoleText();
    try {
      await handleSessionCommand(['discussions', 'read', 'session-prefix', 'discussion-1'], {
        readCredentialsFn: async () => credentials,
      });
      expect(output.text()).toContain('All migrations are green.');
      expect(output.text()).not.toContain('"serverId"');
    } finally {
      output.restore();
    }
  });

  it('publishes discoverable scalar help including repeatable mentions and retry identities', async () => {
    const output = captureConsoleText();
    try {
      await handleSessionCommand(['discussions', 'create', '--help'], {
        readCredentialsFn: async () => credentials,
      });
      expect(output.text()).toContain('happier session discussions create <sessionId> <title> <message>');
      expect(output.text()).toContain('--mentioned-account-ids');
      expect(output.text()).toContain('--creation-local-id');
      expect(output.text()).toContain('--message-local-id');
      expect(output.text()).toContain('--server-id');
    } finally {
      output.restore();
    }
    expect(createCliActionExecutorFromCredentials).not.toHaveBeenCalled();
  });

  it('projects the discussion command family and repeatable mention flag into shell completion', () => {
    const commands = listCompiledActionCliCommands();
    expect(resolveCompiledActionCliCompletionCandidates({
      committed: ['session'],
      prefix: 'd',
      commands,
    })).toContain('discussions');
    expect(resolveCompiledActionCliCompletionCandidates({
      committed: ['session', 'discussions'],
      prefix: '',
      commands,
    })).toEqual(expect.arrayContaining([
      'list', 'show', 'read', 'create', 'post', 'rename', 'archive', 'restore', 'read-state',
    ]));
    expect(resolveCompiledActionCliCompletionCandidates({
      committed: [
        'session', 'discussions', 'create', 'session-1', 'Title', 'Message',
        '--mentioned-account-ids', 'account-a',
      ],
      prefix: '--mentioned',
      commands,
    })).toContain('--mentioned-account-ids');
  });
});
