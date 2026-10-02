import { describe, expect, it, vi } from 'vitest';

import { bindManagedHerdrSession } from './bindManagedSession';
import { ApiSessionClient } from '@/api/session/sessionClient';
import { createPlainSessionFixture } from '@/testkit/backends/sessionFixtures';
import { bindApiSessionSocketPairMock, createApiSessionSocketStub, resolveApiSessionSocketDefaultAck } from '@/testkit/backends/apiSessionSocketHarness';

const { mockIo } = vi.hoisted(() => ({ mockIo: vi.fn() }));
// Socket.IO is the external transport boundary; session state and its supervisor stay real.
vi.mock('socket.io-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('socket.io-client')>(),
  io: mockIo,
}));

describe('managed Herdr activity', () => {
  it('projects pending remote approvals before thinking and clears them through the real session state', async () => {
    const sessionSocket = createApiSessionSocketStub({
      emitWithAck: async (event, payload) => {
        if (event === 'update-state') {
          const update = payload as { agentState: unknown; expectedVersion: number };
          return { result: 'success', agentState: update.agentState, version: update.expectedVersion + 1 };
        }
        return resolveApiSessionSocketDefaultAck(event, payload);
      },
    });
    bindApiSessionSocketPairMock(mockIo, {
      sessionSocket,
      userSocket: createApiSessionSocketStub(),
    });
    // A supported older server has no features endpoint. Keep contract negotiation real.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const session = new ApiSessionClient('test-token', createPlainSessionFixture({
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

      await session.updateAgentState((state) => ({
        ...state,
        requests: {},
        completedRequests: { approval: { tool: 'Write', arguments: { path: '/tmp/example' }, createdAt: 1, completedAt: 2, status: 'approved' } },
      }));
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
