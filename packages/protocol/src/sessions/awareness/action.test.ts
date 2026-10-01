import { describe, expect, it } from 'vitest';

import {
  SESSION_LIST_AWARENESS_VIEW_V1,
  SessionListActionResultV1Schema,
  SessionActivityCompatibilityResultV1Schema,
  SessionAwarenessListResultV1Schema,
  buildSessionAwarenessListResultV1,
  markSessionListQueryResultV1,
  parseSessionAwarenessListResultV1,
  parseSessionListQueryActionResultV1,
  projectSessionActivityCompatibilityV1,
} from './action.js';
import type { SessionAwarenessProjectionV1 } from './projectionV1.js';

function awareness(
  overrides: Partial<SessionAwarenessProjectionV1> = {},
): SessionAwarenessProjectionV1 {
  return {
    v: 1,
    sessionId: 'session-1',
    lifecycle: 'active',
    runtime: 'working',
    freshness: 'live',
    operational: { primary: 'working', reasons: ['working'] },
    encryption: 'plain',
    availability: 'complete',
    ...overrides,
  };
}

describe('session.list awareness marked result', () => {
  it('preserves historical metadata omissions without inventing more pages in either result view', () => {
    const page = {
      sessions: [awareness()],
      nextCursor: null,
      hasNext: false,
      attentionNextCursor: null,
      attentionHasNext: false,
      metadataUpgradeRequiredCount: 2,
    };
    const payload = buildSessionAwarenessListResultV1(page);
    expect(payload).toMatchObject({ metadataUpgradeRequiredCount: 2, hasNext: false, attentionHasNext: false });
    expect(parseSessionAwarenessListResultV1(payload)).toEqual(payload);
    expect(parseSessionListQueryActionResultV1(payload)).toEqual(payload);

    const summary = markSessionListQueryResultV1({ ...page, sessions: [] });
    expect(parseSessionListQueryActionResultV1(summary)).toEqual(summary);
    expect(parseSessionListQueryActionResultV1({ ...summary, metadataUpgradeRequiredCount: -1 })).toBeNull();
    expect(parseSessionAwarenessListResultV1({ ...payload, metadataUpgradeRequiredCount: 1.5 })).toBeNull();
  });

  it('parses only the exact marked awareness payload inside the Action success envelope', () => {
    const payload = buildSessionAwarenessListResultV1({
      sessions: [awareness()],
      nextCursor: null,
      hasNext: false,
    });

    expect(payload).toEqual({
      view: SESSION_LIST_AWARENESS_VIEW_V1,
      projectionVersion: 1,
      sessions: [awareness()],
      nextCursor: null,
      hasNext: false,
    });

    expect(parseSessionAwarenessListResultV1(payload)?.sessions).toHaveLength(1);
    expect(parseSessionAwarenessListResultV1({ ok: true, ...payload })).toBeNull();
  });

  it('keeps Lane 07 attention continuation on a strict-query summary result', () => {
    const payload = markSessionListQueryResultV1({
      sessions: [],
      nextCursor: null,
      hasNext: false,
      attentionNextCursor: 'attention-next',
      attentionHasNext: true,
    });

    expect(payload).toEqual({
      sessions: [],
      nextCursor: null,
      hasNext: false,
      attentionNextCursor: 'attention-next',
      attentionHasNext: true,
      queryVersion: 1,
    });
    expect(parseSessionListQueryActionResultV1(payload)).toEqual(payload);
  });

  it('rejects a query-marked summary without the attention continuation pair', () => {
    const markerOnly = {
      sessions: [],
      nextCursor: null,
      hasNext: false,
      queryVersion: 1,
    } as const;

    expect(parseSessionListQueryActionResultV1(markerOnly)).toBeNull();
    expect(SessionListActionResultV1Schema.safeParse(markerOnly).success).toBe(false);
    expect(() => markSessionListQueryResultV1(markerOnly as never)).toThrow();

    if (false) {
      // @ts-expect-error strict query markers require the complete attention continuation pair
      markSessionListQueryResultV1({ sessions: [], nextCursor: null, hasNext: false });
    }
  });

  it('preserves paired Lane 07 attention continuation on awareness without adding a query marker', () => {
    const payload = buildSessionAwarenessListResultV1({
      sessions: [],
      nextCursor: null,
      hasNext: false,
      attentionNextCursor: 'attention-next',
      attentionHasNext: true,
    });
    expect(SessionAwarenessListResultV1Schema.parse(payload)).toEqual(payload);
    expect(parseSessionListQueryActionResultV1(payload)).toEqual(payload);
    expect(payload).not.toHaveProperty('queryVersion');
    expect(SessionAwarenessListResultV1Schema.safeParse({
      ...payload,
      queryVersion: 1,
    }).success).toBe(false);
  });

  it('requires both continuation families only when awareness answers a strict query', () => {
    const predecessorCompatible = buildSessionAwarenessListResultV1({
      sessions: [], nextCursor: null, hasNext: false,
    });

    expect(parseSessionAwarenessListResultV1(predecessorCompatible)).toEqual(predecessorCompatible);
    expect(parseSessionListQueryActionResultV1(predecessorCompatible)).toBeNull();
  });

  it('rejects one-sided attention continuation on awareness', () => {
    const payload = buildSessionAwarenessListResultV1({ sessions: [], nextCursor: null, hasNext: false });
    expect(SessionAwarenessListResultV1Schema.safeParse({
      ...payload,
      attentionNextCursor: 'attention-next',
    }).success).toBe(false);
    expect(SessionAwarenessListResultV1Schema.safeParse({
      ...payload,
      attentionHasNext: true,
    }).success).toBe(false);
  });

  it('rejects an ordinary Session summary list so an old host cannot report false success', () => {
    // Exactly what a host that silently ignores `view` returns (AWI-09).
    const summary = {
      ok: true,
      sessions: [{ id: 'session-1', createdAt: 1, updatedAt: 2, active: true, activeAt: 2, encryption: null }],
      nextCursor: null,
      hasNext: false,
    };
    expect(parseSessionAwarenessListResultV1(summary)).toBeNull();
  });

  it('rejects a different projection version and unknown top-level fields', () => {
    const base = buildSessionAwarenessListResultV1({ sessions: [], nextCursor: null, hasNext: false });
    expect(parseSessionAwarenessListResultV1({ ...base, projectionVersion: 2 })).toBeNull();
    expect(parseSessionAwarenessListResultV1({ ...base, unread: 3 })).toBeNull();
    expect(SessionAwarenessListResultV1Schema.safeParse({ ...base, view: 'summary' }).success).toBe(false);
  });

  it('rejects a viewer-personal field smuggled into a projected row', () => {
    const base = buildSessionAwarenessListResultV1({ sessions: [], nextCursor: null, hasNext: false });
    expect(parseSessionAwarenessListResultV1({
      ...base,
      sessions: [{ ...awareness(), needsMyAttention: true }],
    })).toBeNull();
  });
});

describe('session.activity.get compatibility projection', () => {
  it('accepts the released CLI success projection without inventing UI-only facts', () => {
    expect(SessionActivityCompatibilityResultV1Schema.parse({
      ok: true,
      sessionId: 'session-1',
      active: true,
      updatedAt: 1_700_000_000_000,
      pendingCount: 2,
      pendingPermissionRequestCount: 1,
      pendingUserActionRequestCount: 1,
    })).toEqual({
      ok: true,
      sessionId: 'session-1',
      active: true,
      updatedAt: 1_700_000_000_000,
      pendingCount: 2,
      pendingPermissionRequestCount: 1,
      pendingUserActionRequestCount: 1,
    });
  });

  it('derives the released operational booleans from awareness, not from a second status owner', () => {
    const result = projectSessionActivityCompatibilityV1({
      awareness: awareness({
        runtime: 'waiting',
        operational: {
          primary: 'permission_required',
          reasons: ['permission_required', 'pending_input'],
        },
      }),
      facts: {
        presence: 'online',
        active: true,
        thinking: false,
        updatedAt: 1_700_000_000_000,
        permissionRequestIds: ['req-1'],
      },
    });

    expect(result).toEqual({
      ok: true,
      sessionId: 'session-1',
      presence: 'online',
      active: true,
      thinking: false,
      working: false,
      blocked: true,
      permissionRequired: true,
      actionRequired: false,
      updatedAt: 1_700_000_000_000,
      permissionRequestIds: ['req-1'],
    });
  });

  it('keeps background runtime activity out of `working` (AWI-15)', () => {
    const result = projectSessionActivityCompatibilityV1({
      awareness: awareness({
        runtime: 'background_active',
        operational: { primary: 'none', reasons: ['background_activity'] },
      }),
      facts: { presence: null, active: true, thinking: false, updatedAt: null, permissionRequestIds: [] },
    });
    expect(result.working).toBe(false);
  });

  it('retains foreground work when reachability is unknown', () => {
    const result = projectSessionActivityCompatibilityV1({
      awareness: awareness({
        runtime: 'unknown',
        freshness: 'unknown',
        operational: { primary: 'working', reasons: ['working'] },
      }),
      facts: { presence: null, active: true, thinking: false, updatedAt: null },
    });
    expect(result.working).toBe(true);
  });

  it('reports working for a foreground turn and action_required separately from permissions', () => {
    const result = projectSessionActivityCompatibilityV1({
      awareness: awareness({
        runtime: 'working',
        operational: { primary: 'action_required', reasons: ['action_required', 'working'] },
      }),
      facts: { presence: 'online', active: true, thinking: true, updatedAt: null, permissionRequestIds: [] },
    });
    expect(result.working).toBe(true);
    expect(result.actionRequired).toBe(true);
    expect(result.permissionRequired).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it('omits request identities a host cannot observe rather than claiming an empty set', () => {
    // A host that only holds pending COUNTS (the CLI/daemon reads a V2 row, not the agent state)
    // must not answer `permissionRequestIds: []` beside `permissionRequired: true`: an approval
    // caller would read that as "nothing to approve" and silently drop a real request.
    const result = projectSessionActivityCompatibilityV1({
      awareness: awareness({
        operational: { primary: 'permission_required', reasons: ['permission_required'] },
      }),
      facts: { presence: 'online', active: true, thinking: false, updatedAt: null },
    });
    expect(result.permissionRequired).toBe(true);
    expect(result).not.toHaveProperty('permissionRequestIds');
  });

  it('passes the ancillary local-window counts through untouched and omits them when unsupplied', () => {
    const facts = { presence: null, active: false, thinking: false, updatedAt: null, permissionRequestIds: [] };
    expect(projectSessionActivityCompatibilityV1({ awareness: awareness(), facts }))
      .not.toHaveProperty('messageCounts');
    expect(projectSessionActivityCompatibilityV1({
      awareness: awareness(),
      facts: { ...facts, messageCounts: { total: 4, assistant: 3, user: 1 } },
    }).messageCounts).toEqual({ total: 4, assistant: 3, user: 1 });
  });
});
