import { describe, expect, it, vi } from 'vitest';

import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { buildSessionAwarenessListResultV1, markSessionListQueryResultV1 } from '../sessions/awareness/action.js';
import type { SessionListQueryV1 } from '../sessions/listing/query.js';
import { getActionSpec } from './actionSpecs.js';

function createExecutor(overrides: Partial<ActionExecutorDeps> = {}) {
  return createActionExecutor({
    executionRunStart: async () => ({}),
    executionRunList: async () => ({}),
    executionRunGet: async () => ({}),
    detachedExecutionRunSend: async () => ({}),
    executionRunStop: async () => ({}),
    executionRunAction: async () => ({}),
    executionRunWait: async () => ({}),
    sessionOpen: async () => ({}),
    sessionFork: async () => ({}),
    sessionRollback: async () => ({}),
    sessionSpawnNew: async () => ({}),
    pathsListRecent: async () => ({ items: [] }),
    machinesList: async () => ({ items: [] }),
    serversList: async () => ({ items: [] }),
    reviewEnginesList: async () => ({ items: [] }),
    agentsBackendsList: async () => ({ items: [] }),
    agentsModelsList: async () => ({ items: [] }),
    sessionSendMessage: async () => ({}),
    sessionPermissionRespond: async () => ({}),
    sessionUserActionAnswer: async () => ({}),
    sessionModeSet: async () => ({}),
    sessionModesList: async () => ({ items: [] }),
    sessionTargetPrimarySet: async () => ({}),
    sessionTargetTrackedSet: async () => ({}),
    sessionList: async () => ({ sessions: [] }),
    sessionActivityGet: async () => ({}),
    sessionRecentMessagesGet: async () => ({}),
    daemonMemorySearch: async () => ({ v: 1, ok: true as const, hits: [] }),
    daemonMemoryGetWindow: async () => ({ v: 1, snippets: [], citations: [] }),
    daemonMemoryEnsureUpToDate: async () => ({}),
    resetGlobalVoiceAgent: async () => {},
    ...overrides,
  });
}

const canonicalQuery: SessionListQueryV1 = {
  v: 1,
  storage: 'active',
  includeInactive: false,
  scope: 'all_accessible',
  attention: 'any',
  audiences: [],
  tagIds: [],
};

// Exercise the credential-backed direct API path here. Autonomous Agent listing has a separate
// execution-principal admission contract; this suite isolates result validation after admission.
const agentContext = {
  surface: 'api',
  authority: 'account_automation',
  bypassApprovals: true,
} as const;

describe('session.list execution', () => {
  it('validates list output as a summary or closed marked awareness result', () => {
    const schema = getActionSpec('session.list').outputSchema;
    expect(schema.safeParse({ unrelated: 'not a list' }).success).toBe(false);
    expect(schema.safeParse({
      view: 'awareness', projectionVersion: 2, sessions: [], nextCursor: null, hasNext: false,
    }).success).toBe(false);
    expect(schema.safeParse({
      sessions: [{ id: 'legacy-ui', active: false, presence: 'offline', updatedAt: 10 }], nextCursor: null,
    }).success).toBe(true);
    expect(schema.safeParse({
      sessions: [], nextCursor: null, hasNext: false,
      attentionNextCursor: null, attentionHasNext: false,
    }).success).toBe(true);
    expect(schema.safeParse({
      sessions: [], nextCursor: null, hasNext: false, attentionNextCursor: null,
    }).success).toBe(false);
    expect(schema.safeParse({
      sessions: [], nextCursor: null, hasNext: false, queryVersion: 1,
    }).success).toBe(false);
    expect(schema.safeParse({
      view: 'awareness', projectionVersion: 1, sessions: [], nextCursor: null, hasNext: false,
      attentionNextCursor: null, attentionHasNext: false,
    }).success).toBe(true);
    expect(schema.safeParse({
      view: 'awareness', projectionVersion: 1, sessions: [], nextCursor: null, hasNext: false,
      attentionNextCursor: null,
    }).success).toBe(false);
  });
  it('retains exact Home and cancellation when the compatibility activity Action acquires awareness', async () => {
    let request: unknown;
    const executor = createExecutor({ sessionActivityGet: async (args) => {
      request = args;
      return { ok: true, sessionId: args.sessionId };
    } });
    const signal = new AbortController().signal;
    await executor.execute('session.activity.get', { sessionId: 'same-id' }, {
      ...agentContext, serverId: 'home-two', signal,
    });
    expect(request).toEqual({ context: { ...agentContext, serverId: 'home-two', signal }, sessionId: 'same-id', serverId: 'home-two', signal });
  });
  it('forwards the canonical Lane 07 query and the admitted context to the listing owner', async () => {
    const sessionList = vi.fn(async () => markSessionListQueryResultV1({
      sessions: [], nextCursor: null, hasNext: false,
      attentionNextCursor: null, attentionHasNext: false,
    }));
    const executor = createExecutor({ sessionList });
    const signal = new AbortController().signal;

    const result = await executor.execute('session.list', { query: canonicalQuery }, {
      ...agentContext,
      serverId: 'home-1',
      signal,
    });

    expect(sessionList).toHaveBeenCalledWith({ context: { ...agentContext, serverId: 'home-1', signal }, query: canonicalQuery, serverId: 'home-1', signal });
    expect(result).toMatchObject({ ok: true, result: { queryVersion: 1 } });
  });

  it('rejects a marker-only strict-query summary from the listing dependency', async () => {
    const executor = createExecutor({
      sessionList: async () => ({
        sessions: [], nextCursor: null, hasNext: false, queryVersion: 1,
      }),
    });

    const result = await executor.execute('session.list', { query: canonicalQuery }, agentContext);

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'session_list_query_update_required',
    });
  });

  it('rejects an unmarked summary answer when awareness was explicitly requested', async () => {
    // A host that predates awareness silently ignores `view` and answers with a summary list.
    const sessionList = vi.fn(async () => ({
      sessions: [{ id: 'session-1', createdAt: 1, updatedAt: 2, active: true, activeAt: 2, encryption: null }],
      nextCursor: null,
      hasNext: false,
    }));
    const executor = createExecutor({ sessionList });

    const result = await executor.execute('session.list', { view: 'awareness' }, agentContext);

    expect(result).toMatchObject({ ok: false, errorCode: 'awareness_view_unsupported' });
  });

  it('returns the marked awareness result with its marker intact', async () => {
    const payload = buildSessionAwarenessListResultV1({
      sessions: [{
        v: 1,
        sessionId: 'session-1',
        lifecycle: 'active',
        runtime: 'working',
        freshness: 'live',
        operational: { primary: 'working', reasons: ['working'] },
        encryption: 'plain',
        availability: 'complete',
      }],
      nextCursor: 'cursor-2',
      hasNext: true,
    });
    const executor = createExecutor({ sessionList: async () => payload });

    const result = await executor.execute('session.list', { view: 'awareness' }, agentContext);

    expect(result).toEqual({ ok: true, result: payload });
  });

  it('returns strict-query awareness with both continuation families and no query marker', async () => {
    const payload = buildSessionAwarenessListResultV1({
      sessions: [], nextCursor: null, hasNext: false,
      attentionNextCursor: 'attention-next', attentionHasNext: true,
    });
    const executor = createExecutor({ sessionList: async () => payload });

    const result = await executor.execute('session.list', {
      query: canonicalQuery,
      view: 'awareness',
    }, agentContext);

    expect(result).toEqual({ ok: true, result: payload });
    expect(result.result).not.toHaveProperty('queryVersion');
    expect(result.result).toMatchObject({ attentionNextCursor: 'attention-next', attentionHasNext: true });
  });

  it('rejects a predecessor success that silently ignored a strict query', async () => {
    const sessionList = vi.fn(async () => ({
      sessions: [{ id: 'legacy-unfiltered', createdAt: 1, updatedAt: 2, active: true, activeAt: 2, encryption: null }],
      nextCursor: null,
      hasNext: false,
    }));
    const executor = createExecutor({ sessionList });
    const query = {
      v: 1, storage: 'active', includeInactive: false, scope: 'my_work', attention: 'any',
      audiences: [], tagIds: [],
    } as const;

    const result = await executor.execute('session.list', { query }, agentContext);

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'session_list_query_update_required',
    });
  });

  it('passes a listing failure through instead of reporting an unsupported view', async () => {
    const executor = createExecutor({
      sessionList: async () => ({ ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' }),
    });

    const result = await executor.execute('session.list', { view: 'awareness' }, agentContext);

    expect(result).toMatchObject({ ok: false, errorCode: 'not_authenticated' });
  });

  it('normalizes the strict query unavailable response without exposing unrelated error fields', async () => {
    const executor = createExecutor({
      sessionList: async () => {
        throw Object.assign(new Error('private-error-sentinel'), {
          code: 'filtered_session_listing_unavailable',
          details: {
            error: 'not_found',
            code: 'filtered_session_listing_unavailable',
            reason: 'scope',
          },
          responseBody: { privateDiagnostic: 'secret-sentinel' },
        });
      },
    });

    const result = await executor.execute('session.list', { query: canonicalQuery }, agentContext);

    expect(result).toEqual({
      ok: false,
      errorCode: 'filtered_session_listing_unavailable',
      error: 'filtered_session_listing_unavailable',
      details: {
        error: 'not_found',
        code: 'filtered_session_listing_unavailable',
        reason: 'scope',
      },
    });
    expect(JSON.stringify(result)).not.toContain('sentinel');
  });

  it('does not reinterpret a generic 404 as strict query unavailability', async () => {
    const executor = createExecutor({
      sessionList: async () => {
        throw Object.assign(new Error('Unexpected status from /v2/sessions/query: 404'), {
          response: { status: 404 },
          responseBody: { privateDiagnostic: 'secret-sentinel' },
        });
      },
    });

    const result = await executor.execute('session.list', { query: canonicalQuery }, agentContext);

    expect(result).toEqual({
      ok: false,
      errorCode: 'action_failed',
      error: 'Unexpected status from /v2/sessions/query: 404',
    });
    expect(JSON.stringify(result)).not.toContain('secret-sentinel');
  });

  it('rejects awareness combined with a message preview at the input boundary', async () => {
    const sessionList = vi.fn(async () => ({ sessions: [] }));
    const executor = createExecutor({ sessionList });

    const result = await executor.execute('session.list', {
      view: 'awareness',
      includeLastMessagePreview: true,
    }, agentContext);

    expect(result).toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
    expect(sessionList).not.toHaveBeenCalled();
  });
});

describe('session.activity.get awareness view selector', () => {
  const projection = {
    v: 1,
    sessionId: 'session-1',
    lifecycle: 'active',
    runtime: 'working',
    freshness: 'live',
    operational: { primary: 'working', reasons: ['working'] },
    encryption: 'plain',
    availability: 'complete',
  } as const;
  const compatibilityDigest = {
    ok: true,
    sessionId: 'session-1',
    active: true,
    updatedAt: 2,
    pendingCount: 0,
    pendingPermissionRequestCount: 0,
    pendingUserActionRequestCount: 0,
  } as const;

  function viewFieldOf(actionId: 'session.list' | 'session.activity.get') {
    return getActionSpec(actionId).inputHints?.fields.find((field) => field.path === 'view');
  }

  it('offers the one canonical view selector in the Action form hints', () => {
    const field = viewFieldOf('session.activity.get');
    expect(field?.widget).toBe('select');
    expect(field?.options?.map((option) => option.value)).toEqual(['summary', 'awareness']);
    // The selector is owned by the awareness contract, so both Actions offer the same values
    // instead of each host or spec retyping its own list.
    expect(field?.options).toEqual(viewFieldOf('session.list')?.options);
  });

  it('accepts the supported view values, keeps omission valid, and rejects anything else', () => {
    const schema = getActionSpec('session.activity.get').inputSchema;
    expect(schema.safeParse({ sessionId: 'session-1' }).success).toBe(true);
    expect(schema.safeParse({ sessionId: 'session-1', view: 'summary' }).success).toBe(true);
    expect(schema.safeParse({ sessionId: 'session-1', view: 'awareness' }).success).toBe(true);
    expect(schema.safeParse({ sessionId: 'session-1', view: 'operational' }).success).toBe(false);
    expect(schema.safeParse({ sessionId: 'session-1', views: 'awareness' }).success).toBe(false);
  });

  it('rejects awareness combined with the retained-window count input', async () => {
    const sessionActivityGet = vi.fn(async () => projection);
    const executor = createExecutor({ sessionActivityGet });

    const result = await executor.execute('session.activity.get', {
      sessionId: 'session-1',
      view: 'awareness',
      windowSeconds: 60,
    }, agentContext);

    expect(result).toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
    expect(sessionActivityGet).not.toHaveBeenCalled();
  });

  it('forwards the requested view and returns the canonical awareness projection', async () => {
    const sessionActivityGet = vi.fn(async () => projection);
    const executor = createExecutor({ sessionActivityGet });

    const result = await executor.execute('session.activity.get', {
      sessionId: 'session-1',
      view: 'awareness',
    }, agentContext);

    expect(sessionActivityGet).toHaveBeenCalledWith({
      context: agentContext,
      sessionId: 'session-1',
      view: 'awareness',
    });
    expect(result).toEqual({ ok: true, result: projection });
  });

  it('keeps the released compatibility digest when no view is requested', async () => {
    const sessionActivityGet = vi.fn(async () => compatibilityDigest);
    const executor = createExecutor({ sessionActivityGet });

    const result = await executor.execute('session.activity.get', { sessionId: 'session-1' }, agentContext);

    expect(sessionActivityGet).toHaveBeenCalledWith({ context: agentContext, sessionId: 'session-1' });
    expect(result).toEqual({ ok: true, result: compatibilityDigest });
  });

  it('rejects a compatibility digest when awareness was explicitly requested', async () => {
    // A host that predates the selector ignores `view` and answers with its activity digest.
    const executor = createExecutor({ sessionActivityGet: async () => compatibilityDigest });

    const result = await executor.execute('session.activity.get', {
      sessionId: 'session-1',
      view: 'awareness',
    }, agentContext);

    expect(result).toMatchObject({ ok: false, errorCode: 'awareness_view_unsupported' });
  });

  it('passes an activity failure through instead of reporting an unsupported view', async () => {
    const executor = createExecutor({
      sessionActivityGet: async () => ({ ok: false, errorCode: 'session_not_found', error: 'session_not_found' }),
    });

    const result = await executor.execute('session.activity.get', {
      sessionId: 'session-1',
      view: 'awareness',
    }, agentContext);

    expect(result).toMatchObject({ ok: false, errorCode: 'session_not_found' });
  });
});
