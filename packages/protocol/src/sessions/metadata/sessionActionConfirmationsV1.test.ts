import { describe, expect, it } from 'vitest';

import { SessionActionConfirmationsV1Schema } from './sessionActionConfirmationsV1.js';

const request = {
  tool: 'Happier Action confirmation' as const,
  kind: 'user_action' as const,
  arguments: {
    actionId: 'session.activity.get',
    preview: { sessionId: 'session-1' },
    sessionId: 'session-1',
    turnId: 'turn-1',
  },
  createdAt: 1,
  turnId: 'turn-1',
  source: 'happier_action' as const,
  responseTarget: {
    kind: 'happier_action_confirmation_v1' as const,
    requestId: 'action:1',
    actionId: 'session.activity.get',
    inputDigestV1: `sha256:${'0'.repeat(64)}`,
    runtimeAccountId: 'account-runtime',
    sessionId: 'session-1',
    turnId: 'turn-1',
  },
};

describe('SessionActionConfirmationsV1Schema', () => {
  it('admits only the bounded Action-specific Session projection', () => {
    expect(SessionActionConfirmationsV1Schema.parse({
      v: 1,
      requests: { 'action:1': request },
      completedRequests: {},
    }).requests['action:1']).toEqual(request);

    expect(SessionActionConfirmationsV1Schema.safeParse({
      v: 1,
      requests: {
        native: { ...request, tool: 'Bash', source: 'native_tool' },
      },
      completedRequests: {},
    }).success).toBe(false);
    expect(SessionActionConfirmationsV1Schema.safeParse({
      v: 1,
      requests: { 'action:1': { ...request, ownerPrivateState: true } },
      completedRequests: {},
    }).success).toBe(false);
  });
});
