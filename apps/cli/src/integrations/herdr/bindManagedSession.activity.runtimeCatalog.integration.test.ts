import { describe, expect, it, vi } from 'vitest';

import { bindManagedHerdrSession } from './bindManagedSession';
import { ApiSessionClient } from '@/api/session/sessionClient';
import { createPlainSessionFixture } from '@/testkit/backends/sessionFixtures';
import { bindApiSessionSocketPairMock, createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createTestApiSessionClient } from '@/testkit/backends/createTestApiSessionClient';

const { mockIo } = vi.hoisted(() => ({ mockIo: vi.fn() }));
// Socket.IO is the external transport boundary; session state and its supervisor stay real.
vi.mock('socket.io-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('socket.io-client')>(),
  io: mockIo,
}));
// Stored credentials are an OS boundary; this test must never read the user's credentials.
vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readStoredCredentials: vi.fn(async () => null),
}));

describe('managed Herdr activity', () => {
  it('projects pending remote approvals before thinking and clears them through the real session state', async () => {
    const sessionSocket = createApiSessionSocketStub();
    bindApiSessionSocketPairMock(mockIo, {
      sessionSocket,
      userSocket: createApiSessionSocketStub(),
    });
    // A supported older server has no features endpoint. Keep contract negotiation real.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const session = createTestApiSessionClient(ApiSessionClient, 'test-token', createPlainSessionFixture({
      id: 'session-remote-approval',
      agentState: {
        requests: { approval: { tool: 'Write', arguments: { path: '/tmp/example' }, createdAt: 1 } },
      },
    }));
    const request = vi.fn(async () => ({}));
    try {
      bindManagedHerdrSession({
        session,
        client: { findPane: async () => ({ paneId: 'w1:p2', terminalId: 'term_42', workspaceId: 'w1', tabId: 'w1:t1' }), request },
        terminalId: 'term_42', agent: 'claude', sessionId: session.sessionId,
      });
      await vi.waitFor(() => expect(request).toHaveBeenLastCalledWith('pane.report_agent', expect.objectContaining({ state: 'blocked' })));
      session.keepAlive(true, 'remote');
      await vi.waitFor(() => expect(request).toHaveBeenLastCalledWith('pane.report_agent', expect.objectContaining({ state: 'blocked' })));

      // Exercise the supported older server's state update transport, not the current
      // owner-write HTTP tuple contract, which is independent of Herdr projection.
      sessionSocket.trigger('update', {
        id: 'approval-completed', seq: 1, createdAt: 2,
        body: {
          t: 'update-session', sid: session.sessionId,
          agentState: {
            version: 1,
            value: JSON.stringify({
              ...session.getAgentStateSnapshot(),
              requests: {},
              completedRequests: { approval: { tool: 'Write', arguments: { path: '/tmp/example' }, createdAt: 1, completedAt: 2, status: 'approved' } },
            }),
          },
        },
      });
      expect(session.getAgentStateSnapshot()?.requests).toEqual({});
      session.keepAlive(true, 'remote');
      await vi.waitFor(() => expect(request).toHaveBeenLastCalledWith('pane.report_agent', expect.objectContaining({ state: 'working' })));
      session.keepAlive(false, 'remote');
      await vi.waitFor(() => expect(request).toHaveBeenLastCalledWith('pane.report_agent', expect.objectContaining({ state: 'idle' })));
    } finally {
      await session.close();
      vi.unstubAllGlobals();
    }
  });
});
