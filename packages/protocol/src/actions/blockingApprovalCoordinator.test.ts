import { describe, expect, it } from 'vitest';

import type { ApprovalRequest } from '../approvals/approvalRequestV1.js';

import { createBlockingApprovalCoordinator } from './blockingApprovalCoordinator.js';

function approvalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    v: 2,
    status: 'open',
    createdAtMs: 1,
    updatedAtMs: 1,
    createdBy: { surface: 'ui', accountId: 'account-1' },
    requestedSurface: 'ui',
    actionId: 'teams.invitations.create',
    actionArgs: {
      v: 1,
      teamId: 'team-1',
      role: 'member',
      historyAccess: 'from_membership',
      recipientEmail: null,
      requestKey: 'request-1',
    },
    summary: 'Create invitation',
    preview: { actionId: 'teams.invitations.create' },
    origin: {
      v: 1,
      authority: 'present_user',
      caller: { kind: 'human', surface: 'ui', accountId: 'account-1' },
      accountId: 'account-1',
      serverId: 'server-1',
      actionId: 'teams.invitations.create',
      actionInputHash: 'input-hash',
    },
    ...overrides,
  } as ApprovalRequest;
}

describe('createBlockingApprovalCoordinator', () => {
  it('returns an approval decision only to the exact live waiter', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-1',
      request: approvalRequest(),
    });
    const approved = approvalRequest({
      status: 'approved',
      updatedAtMs: 2,
      decision: { kind: 'approve', decidedAtMs: 2 },
    });

    await expect(coordinator.resolveBlockingDecision({
      artifactId: 'approval-1',
      request: approved,
      decision: 'approve',
    })).resolves.toEqual({ resolved: true });
    await expect(pending).resolves.toEqual({ decision: 'approve', request: approved });
    expect(coordinator.getLiveWaiterCount('approval-1')).toBe(0);
  });

  it('does not treat durable approval alone as a result-bearing terminal answer', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    const abortController = new AbortController();
    const approved = approvalRequest({
      status: 'approved',
      updatedAtMs: 2,
      decision: { kind: 'approve', decidedAtMs: 2 },
    });
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-2',
      request: approvalRequest(),
      signal: abortController.signal,
      pollIntervalMs: 1,
      readRequest: async () => approved,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(coordinator.getLiveWaiterCount('approval-2')).toBe(1);
    abortController.abort('origin_unmounted');
    await expect(pending).rejects.toThrow('origin_unmounted');
  });

  it('does not retain an aborted origin as a later result recipient', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    const abortController = new AbortController();
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-3',
      request: approvalRequest(),
      signal: abortController.signal,
    });

    abortController.abort('origin_unmounted');
    await expect(pending).rejects.toThrow('origin_unmounted');
    await expect(coordinator.resolveBlockingDecision({
      artifactId: 'approval-3',
      request: approvalRequest({
        status: 'approved',
        updatedAtMs: 2,
        decision: { kind: 'approve', decidedAtMs: 2 },
      }),
      decision: 'approve',
    })).resolves.toEqual({ resolved: false });
    expect(coordinator.getDetachedWaiterCount('approval-3')).toBe(1);
  });
});
