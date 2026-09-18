import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  createActionExecutor,
  type ActionExecutorDeps,
} from '@happier-dev/protocol/actions';

import { registerApprovalRpcHandlers } from './approvals';

describe('approval RPC handlers', () => {
  it('does not own a static RPC binding table', async () => {
    const source = await readFile(new URL('./approvals.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('APPROVAL_RPC_BINDINGS');
  });

  it('registers approval queue RPC methods through ActionSpec dispatch', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const calls: unknown[] = [];
    const replayApprovedApprovalRequest = vi.fn(async (input: unknown) => ({
      ok: true as const,
      result: { ok: true as const, status: 'executed' as const, input },
    }));

    registerApprovalRpcHandlers({
      rpcHandlerManager: {
        registerHandler(method, handler) {
          handlers.set(method, handler);
        },
      },
      actionExecutor: {
        replayApprovedApprovalRequest,
        execute: async (actionId, input, context) => {
          calls.push({ actionId, input, context });
          return { ok: true, result: { actionId, input } };
        },
      },
    });

    expect([...handlers.keys()]).toEqual([
      RPC_METHODS.APPROVAL_REQUEST_LIST,
      RPC_METHODS.APPROVAL_REQUEST_GET,
      RPC_METHODS.APPROVAL_REQUEST_CREATE,
      RPC_METHODS.APPROVAL_REQUEST_DECIDE,
      RPC_METHODS.APPROVAL_REQUEST_REPLAY_APPROVED,
    ]);

    await expect(handlers.get(RPC_METHODS.APPROVAL_REQUEST_DECIDE)?.({
      artifactId: 'approval-1',
      decision: 'approve',
      serverId: 'server-1',
    })).resolves.toEqual({
      actionId: 'approval.request.decide',
      input: {
        artifactId: 'approval-1',
        decision: 'approve',
        serverId: 'server-1',
      },
    });
    expect(calls).toEqual([
      {
        actionId: 'approval.request.decide',
        input: {
          artifactId: 'approval-1',
          decision: 'approve',
          serverId: 'server-1',
        },
        context: {
          authority: 'account_automation',
          serverId: 'server-1',
          surface: 'rpc',
        },
      },
    ]);

    await expect(handlers.get(RPC_METHODS.APPROVAL_REQUEST_REPLAY_APPROVED)?.({
      artifactId: 'approval-1',
      decision: 'reject',
      authority: 'present_user',
    })).resolves.toEqual({
      ok: true,
      result: {
        ok: true,
        status: 'executed',
        input: { artifactId: 'approval-1' },
      },
    });
    expect(replayApprovedApprovalRequest).toHaveBeenCalledExactlyOnceWith({
      artifactId: 'approval-1',
    });
  });

  it('lets the private daemon method replay an approved Artifact without granting decision authority', async () => {
    const request = {
      v: 2,
      status: 'approved',
      createdAtMs: 1,
      updatedAtMs: 2,
      createdBy: { surface: 'mcp', sessionId: 'session-1' },
      requestedSurface: 'mcp',
      executionOriginV1: {
        v: 1,
        authority: 'account_automation',
        surface: 'mcp',
        caller: { kind: 'host' },
        serverId: 'creator-home',
        machineId: 'machine-exact',
        sessionId: 'session-1',
        target: { kind: 'session', sessionId: 'session-1' },
        actionId: 'session.message.send',
        requestId: 'request-1',
      },
      actionId: 'session.message.send',
      actionArgs: { sessionId: 'session-1', message: 'approved message' },
      summary: 'Send approved message',
      decision: { kind: 'approve', decidedAtMs: 2 },
    } as const;
    let storedRequest: unknown = request;
    const approvalsUpdate = vi.fn(async ({ request: next }: { request: unknown }) => {
      storedRequest = next;
      return { ok: true as const };
    });
    const sessionSendMessage = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const executor = createActionExecutor({
      approvalsGet: async () => storedRequest,
      approvalsUpdate,
      isApprovalExecutionOriginCurrent: async () => true,
      sessionSendMessage,
    } as unknown as ActionExecutorDeps);
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();

    registerApprovalRpcHandlers({
      rpcHandlerManager: {
        registerHandler(method, handler) {
          handlers.set(method, handler);
        },
      },
      actionExecutor: executor,
    });

    await expect(handlers.get(RPC_METHODS.APPROVAL_REQUEST_REPLAY_APPROVED)?.({
      artifactId: 'approval-1',
      decision: 'reject',
      authority: 'present_user',
    })).resolves.toEqual({
      ok: true,
      result: {
        ok: true,
        status: 'executed',
        execution: expect.objectContaining({ ok: true }),
      },
    });
    expect(sessionSendMessage).toHaveBeenCalledTimes(1);
    // The claim path writes exactly twice: approved→executing, then executing→executed.
    expect(approvalsUpdate).toHaveBeenCalledTimes(2);
    expect(approvalsUpdate.mock.calls.map(([call]) => (call.request as { status: string }).status))
      .toEqual(['executing', 'executed']);

    storedRequest = request;
    approvalsUpdate.mockClear();
    sessionSendMessage.mockClear();
    await expect(handlers.get(RPC_METHODS.APPROVAL_REQUEST_DECIDE)?.({
      artifactId: 'approval-1',
      decision: 'approve',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'present_user_required',
      error: 'present_user_required',
    });
    expect(approvalsUpdate).not.toHaveBeenCalled();
    expect(sessionSendMessage).not.toHaveBeenCalled();
  });
});
