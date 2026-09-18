import { describe, expect, it, vi } from 'vitest';

import { createWorkflowRunCommittedNotificationHandler } from './dispatchWorkflowRunUpdateNotification';

describe('createWorkflowRunCommittedNotificationHandler', () => {
  it.each([
    ['succeeded', 'completed'],
    ['failed', 'failed'],
    ['outcome_uncertain', 'outcome_uncertain'],
    ['paused', 'paused'],
    ['interrupted', 'interrupted'],
  ] as const)('projects a committed %s result to %s', async (state, updateKind) => {
    const dispatch = vi.fn(async () => ({ attemptedChannels: 1, deliveredChannels: 1 }));
    const handler = createWorkflowRunCommittedNotificationHandler({
      getSettingsSnapshot: () => ({ settings: null, settingsSecretsReadKeys: [] }),
      dispatch,
    });

    await handler({
      run: { id: 'run-1' },
      result: { state, reason: state === 'succeeded' ? undefined : 'private-or-provider-detail' },
    });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      event: {
        topic: 'workflow_run_update',
        runId: 'run-1',
        updateKind,
      },
    }));
  });

  it('does not emit a workflow update for cancellation', async () => {
    const dispatch = vi.fn();
    const handler = createWorkflowRunCommittedNotificationHandler({
      getSettingsSnapshot: () => ({ settings: null, settingsSecretsReadKeys: [] }),
      dispatch,
    });

    await handler({ run: { id: 'run-1' }, result: { state: 'cancelled' } });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('preserves collect-outcomes success as completed with failures', async () => {
    const dispatch = vi.fn(async () => ({ attemptedChannels: 1, deliveredChannels: 1 }));
    const handler = createWorkflowRunCommittedNotificationHandler({
      getSettingsSnapshot: () => ({ settings: null, settingsSecretsReadKeys: [] }),
      dispatch,
    });

    await handler({
      run: { id: 'run-1' },
      result: { state: 'succeeded', completedWithFailures: true },
    });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      event: {
        topic: 'workflow_run_update',
        runId: 'run-1',
        updateKind: 'completed_with_failures',
      },
    }));
  });

  it('does not let notification delivery failure change an already committed Run outcome', async () => {
    const handler = createWorkflowRunCommittedNotificationHandler({
      getSettingsSnapshot: () => ({ settings: null, settingsSecretsReadKeys: [] }),
      dispatch: vi.fn(async () => {
        throw new Error('notification transport unavailable');
      }),
    });

    await expect(handler({ run: { id: 'run-1' }, result: { state: 'succeeded' } }))
      .resolves.toBeUndefined();
  });

  it('does not let notification settings lookup failure change an already committed Run outcome', async () => {
    const dispatch = vi.fn();
    const handler = createWorkflowRunCommittedNotificationHandler({
      getSettingsSnapshot: () => {
        throw new Error('settings unavailable');
      },
      dispatch,
    });

    await expect(handler({ run: { id: 'run-1' }, result: { state: 'failed' } }))
      .resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
