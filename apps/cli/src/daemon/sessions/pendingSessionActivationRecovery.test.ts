import { describe, expect, it, vi } from 'vitest';

import {
  createSessionListResponseFixture,
  createSessionRecordFixture,
} from '@/testkit/backends/sessionFixtures';

import {
  createPendingSessionActivationRecovery,
  recoverPendingSessionActivations,
  type PendingSessionActivationInput,
} from './pendingSessionActivationRecovery';

describe('pending session activation recovery', () => {
  it('routes live hints and the reconnect scan through one canonical activator', async () => {
    const activate = vi.fn(async (_input: PendingSessionActivationInput) => undefined);
    const fetchSessionsPage = vi.fn(async () => {
      const fixture = createSessionListResponseFixture([
        createSessionRecordFixture({
          id: 'scan-session',
          pendingVersion: 5,
          pendingActivationAuthorization: { requestId: 'scan-request', requestedAt: 12, status: 'waiting' },
        }),
      ]);
      return {
        sessions: fixture.sessions,
        nextCursor: fixture.nextCursor ?? null,
        hasNext: fixture.hasNext ?? false,
      };
    });
    const recovery = createPendingSessionActivationRecovery({
      token: 'token',
      activate,
      warn: vi.fn(),
      fetchSessionsPage,
    });

    await recovery.activateHint({
      sessionId: 'live-session',
      requestId: 'live-request',
      pendingVersion: 4,
      source: 'live',
    });
    await recovery.recoverAfterConnect();

    expect(activate.mock.calls.map(([hint]) => hint)).toEqual([
      { sessionId: 'live-session', requestId: 'live-request', pendingVersion: 4, source: 'live' },
      { sessionId: 'scan-session', requestId: 'scan-request', pendingVersion: 5, source: 'scan' },
    ]);
    expect(fetchSessionsPage).toHaveBeenCalledOnce();
  });

  it('performs one finite paginated scan and activates every owned waiting authorization', async () => {
    const activate = vi.fn(async (_input: PendingSessionActivationInput) => undefined);
    const fetchSessionsPage = vi.fn()
      .mockResolvedValueOnce({
        sessions: [
          { id: 'waiting-1', pendingVersion: 3, pendingActivationAuthorization: { requestId: 'p1', requestedAt: 10, status: 'waiting' } },
          { id: 'waiting-unknown-target', pendingVersion: 4, pendingActivationAuthorization: { requestId: 'po', requestedAt: 11, status: 'waiting' } },
          { id: 'shared', share: { accessLevel: 'view', canApprovePermissions: false }, pendingVersion: 4, pendingActivationAuthorization: { requestId: 'ps', requestedAt: 11, status: 'waiting' } },
          { id: 'failed', pendingVersion: 4, pendingActivationAuthorization: { requestId: 'pf', requestedAt: 11, status: 'failed', failureCode: 'runtime_start_failed' } },
          { id: 'absent' },
        ],
        hasNext: true,
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        sessions: [
          { id: 'waiting-2', pendingVersion: 5, pendingActivationAuthorization: { requestId: 'p2', requestedAt: 12, status: 'waiting' } },
        ],
        hasNext: false,
        nextCursor: null,
      });

    await recoverPendingSessionActivations({ token: 'token', activate, warn: vi.fn(), fetchSessionsPage });

    expect(fetchSessionsPage).toHaveBeenCalledTimes(2);
    expect(fetchSessionsPage).toHaveBeenNthCalledWith(1, { token: 'token', limit: 200 });
    expect(fetchSessionsPage).toHaveBeenNthCalledWith(2, { token: 'token', limit: 200, cursor: 'next' });
    expect(activate.mock.calls.map(([hint]) => hint)).toEqual([
      { sessionId: 'waiting-1', requestId: 'p1', pendingVersion: 3, source: 'scan' },
      { sessionId: 'waiting-unknown-target', requestId: 'po', pendingVersion: 4, source: 'scan' },
      { sessionId: 'waiting-2', requestId: 'p2', pendingVersion: 5, source: 'scan' },
    ]);
  });

  it('observes one activation failure and continues the finite scan', async () => {
    const warn = vi.fn();
    const activate = vi.fn(async (input: PendingSessionActivationInput) => {
      if (input.sessionId === 'waiting-1') throw new Error('temporary failure');
    });
    const fetchSessionsPage = vi.fn()
      .mockResolvedValueOnce({
        sessions: [
          { id: 'waiting-1', pendingActivationAuthorization: { requestId: 'p1', requestedAt: 10, status: 'waiting' } },
          { id: 'waiting-2', pendingActivationAuthorization: { requestId: 'p2', requestedAt: 11, status: 'waiting' } },
        ],
        hasNext: true,
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        sessions: [
          { id: 'waiting-3', pendingActivationAuthorization: { requestId: 'p3', requestedAt: 12, status: 'waiting' } },
        ],
        hasNext: false,
        nextCursor: null,
      });

    await recoverPendingSessionActivations({ token: 'token', activate, fetchSessionsPage, warn });

    expect(activate.mock.calls.map(([input]) => input.sessionId)).toEqual(['waiting-1', 'waiting-2', 'waiting-3']);
    expect(warn).toHaveBeenCalledOnce();
  });
});
