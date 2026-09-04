import { describe, expect, it } from 'vitest';

import type { PermissionResponseClaim } from './agentStateRequestStore';
import { CodexLikePermissionHandler } from './CodexLikePermissionHandler';
import { ServerBoundPermissionRpcHandlerManager } from './testkit/serverBoundPermissionRpcHandlerManager';

class FakeSession {
  sessionId = 'session-test';
  rpcHandlerManager = new ServerBoundPermissionRpcHandlerManager(this.sessionId);
  agentState: any = { requests: {}, completedRequests: {} };
  metadata: any = null;
  permissionResponseClaimWriteCount = 0;

  getAgentStateSnapshot() {
    return this.agentState;
  }

  updateAgentState(updater: any) {
    const nextState = updater(this.agentState);
    if (Object.values(nextState.requests ?? {}).some((request: any) => (
      request
      && typeof request === 'object'
      && Object.hasOwn(request, 'permissionResponseClaimV1')
    ))) {
      this.permissionResponseClaimWriteCount += 1;
    }
    this.agentState = nextState;
    return this.agentState;
  }

  getMetadataSnapshot() {
    return this.metadata;
  }
}

describe('BasePermissionHandler permission-response routing (gap 28/29)', () => {
  it('returns a typed permission_request_not_found for an unknown explicit id over the RPC route', async () => {
    const session = new FakeSession();
    const handler = new CodexLikePermissionHandler({ session: session as any, logPrefix: '[Test]' });
    handler.setPermissionMode('safe-yolo');

    const rpc = session.rpcHandlerManager.handlers.get('permission');
    expect(rpc).toBeDefined();

    const result = await rpc!({ id: 'never-seen-request', approved: true, decision: 'approved' });
    expect(result).toEqual({
      ok: false,
      errorCode: 'permission_request_not_found',
      requestId: 'never-seen-request',
    });
  });

  it('returns void (success) over the RPC route when the explicit id resolves a pending request', async () => {
    const session = new FakeSession();
    const handler = new CodexLikePermissionHandler({ session: session as any, logPrefix: '[Test]' });
    handler.setPermissionMode('safe-yolo');

    const promise = handler.handleToolCall('tool-1', 'Write', { path: '/tmp/x', content: 'hi' });

    const rpc = session.rpcHandlerManager.handlers.get('permission');
    const result = await rpc!({ id: 'tool-1', approved: true, decision: 'approved' });
    expect(result).toBeUndefined();
    expect((await promise).decision).toBe('approved');
  });

  it('durably claims an authenticated present-user answer before settling the request', async () => {
    const session = new FakeSession();
    const handler = new CodexLikePermissionHandler({ session: session as any, logPrefix: '[Test]' });
    handler.setPermissionMode('safe-yolo');

    const promise = handler.handleToolCall('preactivation-request', 'Write', { path: '/tmp/x', content: 'hi' });
    const rpc = session.rpcHandlerManager.handlers.get('session.permission.respond');

    await expect(rpc!({ id: 'preactivation-request', approved: true, decision: 'approved' })).resolves.toBeUndefined();
    await expect(promise).resolves.toEqual(expect.objectContaining({ decision: 'approved' }));
    expect(session.permissionResponseClaimWriteCount).toBe(1);
  });

  it('does not let a delayed answer from turn A settle a reused request id in turn B', async () => {
    const session = new FakeSession();
    const handler = new CodexLikePermissionHandler({ session: session as any, logPrefix: '[Test]' });
    handler.setPermissionMode('safe-yolo');
    const rpc = session.rpcHandlerManager.handlers.get('session.permission.respond');
    const causalContext = (turnId: string) => ({
      turnId,
      causalPermissionAuthority: {
        kind: 'admittedSessionInputV1' as const,
        admittedPermissionCeiling: 'default' as const,
      },
    });

    const turnA = handler.handleToolCall(
      'reused-request',
      'Write',
      { path: '/tmp/a', content: 'a' },
      causalContext('turn-a'),
    );
    await expect(rpc!({
      id: 'reused-request',
      turnId: 'turn-a',
      approved: false,
      decision: 'denied',
    })).resolves.toBeUndefined();
    await expect(turnA).resolves.toEqual(expect.objectContaining({ decision: 'denied' }));
    await expect(rpc!({
      id: 'reused-request',
      turnId: 'turn-a',
      approved: false,
      decision: 'denied',
    })).resolves.toBeUndefined();

    const turnB = handler.handleToolCall(
      'reused-request',
      'Write',
      { path: '/tmp/b', content: 'b' },
      causalContext('turn-b'),
    );
    await expect(rpc!({
      id: 'reused-request',
      turnId: 'turn-a',
      approved: true,
      decision: 'approved',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'permission_request_not_found',
      requestId: 'reused-request',
    });
    expect(session.agentState.requests['reused-request']).toEqual(expect.objectContaining({ turnId: 'turn-b' }));

    await expect(rpc!({
      id: 'reused-request',
      turnId: 'turn-b',
      approved: true,
      decision: 'approved',
    })).resolves.toBeUndefined();
    await expect(turnB).resolves.toEqual(expect.objectContaining({ decision: 'approved' }));
  });

  it('keeps a claimed present-user answer nonauthorizing after handler reset', async () => {
    const session = new FakeSession();
    const original = new CodexLikePermissionHandler({ session: session as any, logPrefix: '[Original]' });
    original.setPermissionMode('safe-yolo');

    const originalWaiter = original.handleToolCall(
      'generation-transition-request',
      'Write',
      { path: '/tmp/x', content: 'hi' },
    );
    const originalOutcome = originalWaiter.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    await Promise.resolve();
    const claimedPresentUserAnswer = {
      version: 1,
      origin: 'presentUser',
      actor: {
        kind: 'accountUser',
        accountId: 'account-owner',
        relationship: 'owner',
      },
      decision: 'approved',
      scope: 'request',
    } satisfies PermissionResponseClaim;
    session.agentState.requests['generation-transition-request'].permissionResponseClaimV1 = claimedPresentUserAnswer;

    // Reset is a lifecycle cancellation boundary. Its Agent-state terminal
    // cancellation, not the in-flight answer claim, survives replacement.
    await original.reset();
    const replacement = new CodexLikePermissionHandler({ session: session as any, logPrefix: '[Replacement]' });
    replacement.setPermissionMode('safe-yolo');
    const rpc = session.rpcHandlerManager.handlers.get('session.permission.respond');
    expect(rpc).toBeDefined();

    await expect(rpc!({
      id: 'generation-transition-request',
      approved: false,
      decision: 'denied',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'permission_request_not_found',
      requestId: 'generation-transition-request',
    });
    expect(session.agentState.requests['generation-transition-request']).toBeUndefined();
    expect(session.agentState.completedRequests['generation-transition-request']).toEqual(expect.objectContaining({
      status: 'canceled',
      decision: 'abort',
      reason: 'Session reset',
    }));

    await expect(rpc!({
      id: 'generation-transition-request',
      approved: true,
      decision: 'approved',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'permission_request_not_found',
      requestId: 'generation-transition-request',
    });
    expect(session.agentState.completedRequests['generation-transition-request']).toEqual(expect.objectContaining({
      status: 'canceled',
      decision: 'abort',
    }));

    const settledOriginal = await originalOutcome;
    expect(settledOriginal.status).toBe('rejected');
    expect(settledOriginal.status === 'rejected' ? settledOriginal.error : null).toEqual(
      expect.objectContaining({ message: 'Session reset' }),
    );
    await original.reset();
    await replacement.reset();
  });

});
