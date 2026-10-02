import { describe, expect, it } from 'vitest';
import { shouldAutoApprovePermissionRequest, autoResolvePendingPermissionRequests } from '../../src/testkit/providers/harness';
import { RpcHandlerManager } from '../../../../apps/cli/src/api/rpc/RpcHandlerManager';

describe('providers harness: yolo permission auto-approval guard', () => {
  it('allows scenario opt-in for unexpected yolo permission requests', () => {
    expect(
      shouldAutoApprovePermissionRequest({
        yolo: false,
        allowPermissionAutoApproveInYolo: false,
        toolName: 'Edit',
      }),
    ).toBe(true);

    expect(
      shouldAutoApprovePermissionRequest({
        yolo: true,
        allowPermissionAutoApproveInYolo: false,
        toolName: 'AcpHistoryImport',
      }),
    ).toBe(true);

    expect(
      shouldAutoApprovePermissionRequest({
        yolo: true,
        allowPermissionAutoApproveInYolo: false,
        toolName: 'Edit',
      }),
    ).toBe(false);

    expect(
      shouldAutoApprovePermissionRequest({
        yolo: true,
        allowPermissionAutoApproveInYolo: true,
        toolName: 'Edit',
      }),
    ).toBe(true);
  });

  it('auto-resolves pending requests when yolo auto-approve is enabled', async () => {
    const approvedIds = new Set<string>();
    const secret = new Uint8Array(32);
    const requests: unknown[] = [];
    const responder = new RpcHandlerManager({
      scopePrefix: 'sess-1', encryptionKey: secret, encryptionVariant: 'legacy', logger: () => {},
    });
    responder.registerHandler('permission', (payload: unknown) => {
      requests.push(payload);
      return { ok: true };
    });
    const answers = {
      components: ['alpha-beta', 'gamma', 'Custom, other'],
    } as const;

    const result = await autoResolvePendingPermissionRequests({
      pendingPermissionIds: [{ id: 'perm-1', toolName: 'unknown' }],
      approvedPermissionIds: approvedIds,
      yolo: true,
      allowPermissionAutoApproveInYolo: true,
      decision: 'approved',
      answers,
      sessionId: 'sess-1',
      secret,
      uiSocket: {
        emit: () => {},
        emitWithAck: async <T = unknown>(_event: string, data: unknown): Promise<T> => {
          // The fake network accepts the canonical caller's request payload.
          const request = data as { method: string; params: unknown };
          return { ok: true, result: await responder.handleRequest(request) } as T;
        },
      },
    });

    expect(result.blockedInYolo).toEqual([]);
    expect(result.approvedIds).toEqual(['perm-1']);
    expect(approvedIds.has('perm-1')).toBe(true);
    expect(requests).toEqual([{
      id: 'perm-1',
      approved: true,
      decision: 'approved',
      answers,
    }]);
  });
});
