import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => vi.useRealTimers());
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

  it('reads durable changes without polling and waits for the built-in execution result', async () => {
    vi.useFakeTimers();
    const coordinator = createBlockingApprovalCoordinator();
    const approved = approvalRequest({
      status: 'approved',
      updatedAtMs: 2,
      decision: { kind: 'approve', decidedAtMs: 2 },
    });
    let request = approvalRequest();
    let onChange = () => {};
    const dispose = vi.fn();
    const readRequest = vi.fn(async () => request);
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-2',
      request: approvalRequest(),
      readRequest,
      subscribeChanges: (change) => {
        onChange = change;
        return { dispose };
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readRequest).toHaveBeenCalledTimes(1);
    request = approved;
    onChange();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readRequest).toHaveBeenCalledTimes(2);
    expect(coordinator.getLiveWaiterCount('approval-2')).toBe(1);
    request = approvalRequest({
      ...approved,
      status: 'executed',
      execution: { executedAtMs: 3, ok: true, result: { ok: true } },
    });
    onChange();
    await expect(pending).resolves.toEqual({ decision: 'approve', request });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('subscribes before reading and coalesces changes received during a durable read', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    let resolveRead: (request: ApprovalRequest) => void = () => {};
    let onChange = () => {};
    let subscribed = false;
    const rejected = approvalRequest({ status: 'rejected', decision: { kind: 'reject', decidedAtMs: 2 } });
    const readRequest = vi.fn(() => {
      expect(subscribed).toBe(true);
      return new Promise<ApprovalRequest>((resolve) => { resolveRead = resolve; });
    });
    const dispose = vi.fn();
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-race',
      request: approvalRequest(),
      readRequest,
      subscribeChanges: (change) => {
        subscribed = true;
        onChange = change;
        return { dispose };
      },
    });
    onChange();
    onChange();
    onChange();
    resolveRead(approvalRequest());
    await Promise.resolve();
    expect(readRequest).toHaveBeenCalledTimes(2);
    resolveRead(rejected);
    await expect(pending).resolves.toEqual({ decision: 'reject', request: rejected });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('retires the feed on abort and ignores a late durable answer and subsequent changes', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    const controller = new AbortController();
    let resolveRead: (request: ApprovalRequest) => void = () => {};
    let onChange = () => {};
    const dispose = vi.fn();
    const readRequest = vi.fn(() => new Promise<ApprovalRequest>((resolve) => { resolveRead = resolve; }));
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-abort',
      request: approvalRequest(),
      signal: controller.signal,
      readRequest,
      subscribeChanges: (change) => { onChange = change; return { dispose }; },
    });
    const rejected = expect(pending).rejects.toThrow('origin_unmounted');
    controller.abort('origin_unmounted');
    await rejected;
    resolveRead(approvalRequest({ status: 'rejected', decision: { kind: 'reject', decidedAtMs: 2 } }));
    onChange();
    await Promise.resolve();
    expect(readRequest).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(coordinator.getLiveWaiterCount('approval-abort')).toBe(0);
  });

  it('surfaces feed errors and releases the live wait', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    let onError: (error: unknown) => void = () => {};
    const dispose = vi.fn();
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-feed-error',
      request: approvalRequest(),
      readRequest: async () => approvalRequest(),
      subscribeChanges: (_change, error) => { onError = error; return { dispose }; },
    });
    onError(new Error('account_feed_unavailable'));
    await expect(pending).rejects.toThrow('account_feed_unavailable');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(coordinator.getLiveWaiterCount('approval-feed-error')).toBe(0);
  });

  it('ignores abort after a decision while its feed is being released', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    const controller = new AbortController();
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => { release = resolve; });
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-settled-abort',
      request: approvalRequest(),
      signal: controller.signal,
      subscribeChanges: () => ({ dispose: () => released }),
    });
    const rejected = approvalRequest({ status: 'rejected', decision: { kind: 'reject', decidedAtMs: 2 } });
    coordinator.notifyApprovalUpdated({ artifactId: 'approval-settled-abort', request: rejected });
    controller.abort('late_abort');
    expect(coordinator.getDetachedWaiterCount('approval-settled-abort')).toBe(0);
    release();
    await expect(pending).resolves.toEqual({ decision: 'reject', request: rejected });
  });

  it('surfaces a failed durable read instead of keeping an unobservable live wait', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    const dispose = vi.fn();
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-read-error',
      request: approvalRequest(),
      readRequest: async () => { throw new Error('artifact_read_unavailable'); },
      subscribeChanges: () => ({ dispose }),
    });
    await expect(pending).rejects.toThrow('artifact_read_unavailable');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(coordinator.getLiveWaiterCount('approval-read-error')).toBe(0);
  });

  it('releases a synchronously failed subscription before the wait rejects', async () => {
    const coordinator = createBlockingApprovalCoordinator();
    const dispose = vi.fn(async () => {});
    const readRequest = vi.fn(async () => approvalRequest());
    const pending = coordinator.waitForDecision({
      artifactId: 'approval-subscribe-error',
      request: approvalRequest(),
      readRequest,
      subscribeChanges: (_onChange, onError) => {
        onError(new Error('subscription_start_failed'));
        return { dispose };
      },
    });
    await expect(pending).rejects.toThrow('subscription_start_failed');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(readRequest).not.toHaveBeenCalled();
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
