import { describe, expect, it, vi } from 'vitest';

import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';

function createDeps(overrides: Partial<ActionExecutorDeps> = {}): ActionExecutorDeps {
  return {
    executionRunStart: vi.fn(async () => ({})),
    executionRunList: vi.fn(async () => ({})),
    executionRunGet: vi.fn(async () => ({})),
    detachedExecutionRunSend: vi.fn(async () => ({})),
    executionRunStop: vi.fn(async () => ({})),
    executionRunAction: vi.fn(async () => ({})),
    executionRunWait: vi.fn(async () => ({})),
    sessionOpen: vi.fn(async () => ({})),
    sessionFork: vi.fn(async () => ({})),
    sessionRollback: vi.fn(async () => ({})),
    sessionSpawnNew: vi.fn(async () => ({})),
    pathsListRecent: vi.fn(async () => ({ items: [] })),
    machinesList: vi.fn(async () => ({ items: [] })),
    serversList: vi.fn(async () => ({ items: [] })),
    reviewEnginesList: vi.fn(async () => ({ items: [] })),
    agentsBackendsList: vi.fn(async () => ({ items: [] })),
    agentsModelsList: vi.fn(async () => ({ items: [] })),
    sessionSendMessage: vi.fn(async () => ({})),
    sessionPermissionRespond: vi.fn(async () => ({})),
    sessionUserActionAnswer: vi.fn(async () => ({})),
    sessionModeSet: vi.fn(async () => ({})),
    sessionModesList: vi.fn(async () => ({ items: [] })),
    sessionTargetPrimarySet: vi.fn(async () => ({})),
    sessionTargetTrackedSet: vi.fn(async () => ({})),
    sessionList: vi.fn(async () => ({})),
    sessionActivityGet: vi.fn(async () => ({})),
    sessionRecentMessagesGet: vi.fn(async () => ({})),
    resetGlobalVoiceAgent: vi.fn(),
    ...overrides,
  };
}

describe('createActionExecutor (review comments)', () => {
  it('drains explicitly requested pages under the same host-stamped principal without forwarding the Action-only flag', async () => {
    const signal = new AbortController().signal;
    const requests: unknown[] = [];
    const executor = createActionExecutor(createDeps({ reviewCommentAction: async (request) => {
      requests.push(request);
      return { items: [], cursor: requests.length === 1 ? 'second-page' : null };
    } }));
    await expect(executor.execute('reviews.comments.list', { sessionId: 'origin', allPages: true }, {
      surface: 'rpc', serverId: 'server', signal, actionCaller: { kind: 'workflowRun', runId: 'run' },
    })).resolves.toEqual({ ok: true, result: { items: [], cursor: null } });
    expect(requests).toEqual([undefined, 'second-page'].map((cursor) => ({
      actionId: 'reviews.comments.list', serverId: 'server', signal,
      reviewCommentPrincipal: { actor: { kind: 'workflow', runId: 'run' } },
      input: { sessionId: 'origin', states: [], includeHistory: false, limit: 50, ...(cursor ? { cursor } : {}) },
    })));
  });

  it('does not publish a partial all-pages result when a later page fails', async () => {
    let page = 0;
    const executor = createActionExecutor(createDeps({ reviewCommentAction: async () => ++page === 1
      ? { items: [], cursor: 'next' }
      : { ok: false, errorCode: 'review_comment_permission_denied', error: 'review_comment_permission_denied' },
    }));
    await expect(executor.execute('reviews.comments.list', { sessionId: 'origin', allPages: true }, { surface: 'ui' }))
      .resolves.toEqual({ ok: false, errorCode: 'review_comment_permission_denied', error: 'review_comment_permission_denied' });
  });

  it('retains ordinary single-page reads and their continuation cursor', async () => {
    const executor = createActionExecutor(createDeps({ reviewCommentAction: async () => ({ items: [], cursor: 'next' }) }));
    await expect(executor.execute('reviews.comments.list', { sessionId: 'origin' }, { surface: 'ui' }))
      .resolves.toEqual({ ok: true, result: { items: [], cursor: 'next' } });
  });

  it('binds an agent read to its host-stamped review scope and defaults the own session', async () => {
    const reviewCommentAction = vi.fn(async () => ({ items: [], cursor: null }));
    const executor = createActionExecutor(createDeps({ reviewCommentAction }));
    const reviewCommentPrincipal = {
      actor: { kind: 'agent' as const, agentId: 'codex', sessionId: 'session-1' },
    };

    await expect(executor.execute('reviews.comments.list', { runId: 'review-1' }, {
      surface: 'agent', defaultSessionId: 'session-1', reviewCommentPrincipal,
    })).resolves.toMatchObject({ ok: true });

    expect(reviewCommentAction).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ sessionId: 'session-1', runId: 'review-1' }),
      reviewCommentPrincipal,
    }));
  });

  it('refuses an agent review operation when the caller scope cannot be established', async () => {
    const reviewCommentAction = vi.fn();
    const executor = createActionExecutor(createDeps({ reviewCommentAction }));
    await expect(executor.execute('reviews.comments.list', { projectId: 'project-1' }, {
      surface: 'agent',
    })).resolves.toMatchObject({ ok: false, errorCode: 'review_comment_permission_denied' });
    expect(reviewCommentAction).not.toHaveBeenCalled();
  });

  it('routes durable review-comment actions through the host review-comment executor', async () => {
    const reviewCommentAction = vi.fn(async () => ({ items: [], cursor: null }));
    const executor = createActionExecutor(createDeps({ reviewCommentAction }));

    const result = await executor.execute(
      'reviews.comments.list',
      { projectId: 'project-1', states: ['open'] },
      { surface: 'ui', serverId: 'server-1' },
    );

    expect(result).toEqual({ ok: true, result: { items: [], cursor: null } });
    expect(reviewCommentAction).toHaveBeenCalledWith({
      actionId: 'reviews.comments.list',
      input: { projectId: 'project-1', states: ['open'], includeHistory: false, limit: 50 },
      serverId: 'server-1',
    });
  });

  it('forwards a host-derived review principal through canonical dispatch', async () => {
    const reviewCommentAction = vi.fn(async () => ({ comment: { id: 'comment-1' } }));
    const executor = createActionExecutor(createDeps({ reviewCommentAction }));
    const reviewCommentPrincipal = {
      actor: { kind: 'agent' as const, agentId: 'acme.review', sessionId: 'session-1' },
    };

    await executor.execute('reviews.comments.create', {
      projectId: 'project-1',
      anchor: { kind: 'line', filePath: 'src/a.ts', line: 1 },
      snapshot: { kind: 'too_large', filePath: 'src/a.ts', sizeBytes: 2, capBytes: 1, capturedAt: 1 },
      body: 'Fix this.',
      clientMutationId: 'mutation-1',
    }, { surface: 'rpc', bypassApprovals: true, reviewCommentPrincipal });

    expect(reviewCommentAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'reviews.comments.create',
      reviewCommentPrincipal,
    }));
  });

  it('derives the review principal from the host-stamped plugin caller', async () => {
    const reviewCommentAction = vi.fn(async () => ({ items: [], cursor: null }));
    const executor = createActionExecutor(createDeps({ reviewCommentAction }));
    const signal = new AbortController().signal;

    await expect(executor.execute(
      'reviews.comments.list',
      { projectId: 'project-1' },
      {
        surface: 'plugin',
        actionCaller: { kind: 'plugin', pluginId: 'acme.review' },
        signal,
      },
    )).resolves.toEqual({ ok: true, result: { items: [], cursor: null } });

    expect(reviewCommentAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'reviews.comments.list',
      reviewCommentPrincipal: {
        actor: { kind: 'plugin', pluginId: 'acme.review' },
      },
      signal,
    }));
  });

  it('rejects a plugin-surface review action without a host-stamped caller', async () => {
    const reviewCommentAction = vi.fn();
    const executor = createActionExecutor(createDeps({ reviewCommentAction }));

    await expect(executor.execute(
      'reviews.comments.list',
      { projectId: 'project-1' },
      { surface: 'plugin' },
    )).resolves.toEqual({
      ok: false,
      errorCode: 'plugin_action_caller_required',
      error: 'plugin_action_caller_required',
    });
    expect(reviewCommentAction).not.toHaveBeenCalled();
  });

  it('rejects a caller-supplied or cross-plugin review principal', async () => {
    const reviewCommentAction = vi.fn();
    const executor = createActionExecutor(createDeps({ reviewCommentAction }));

    await expect(executor.execute(
      'reviews.comments.list',
      { projectId: 'project-1' },
      {
        surface: 'plugin',
        actionCaller: { kind: 'plugin', pluginId: 'acme.review' },
        reviewCommentPrincipal: {
          actor: { kind: 'plugin', pluginId: 'other.review' },
        },
      },
    )).resolves.toEqual({
      ok: false,
      errorCode: 'review_comment_permission_denied',
      error: 'review_comment_permission_denied',
    });
    expect(reviewCommentAction).not.toHaveBeenCalled();
  });
});
