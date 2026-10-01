import { describe, expect, it, vi } from 'vitest';

import {
  createWorkflowActivityPublisher,
  SESSION_WORKFLOW_RUN_SNAPSHOT_PROJECTION_VERSION,
  type SessionActivityHeadlineBundleV1,
  type SessionWorkflowRunSnapshotV1,
} from '@happier-dev/plugin-sdk/sessions/work-state';

function runSnapshot(): SessionWorkflowRunSnapshotV1 {
  return {
    v: 1, projectionVersion: SESSION_WORKFLOW_RUN_SNAPSHOT_PROJECTION_VERSION,
    runId: 'a', backendId: 'claude', title: 'Run A', status: 'active',
    recordRevision: '1', updatedAt: 1000, totalAgents: 1, completedAgents: 0,
    phases: [], agents: [],
  };
}

describe('workflow headline publication', () => {
  it('suppresses unchanged headlines during failed record retries and publishes recovered state', async () => {
    let available = false;
    const writeHeadlines = vi.fn(async (_bundle: SessionActivityHeadlineBundleV1) => {});
    const publisher = createWorkflowActivityPublisher({
      backendId: 'claude',
      commitRecord: async () => { if (!available) throw new Error('Server unavailable'); },
      writeHeadlines,
    });
    const input = { snapshots: new Map([['a', runSnapshot()]]), changedRunIds: ['a'] };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await publisher.publish(input)).failedRunIds).toEqual(['a']);
    }
    expect(writeHeadlines).toHaveBeenCalledTimes(1);
    expect(writeHeadlines.mock.calls[0]?.[0].workflow.activeRuns).toEqual([]);

    available = true;
    await publisher.publish(input);
    expect(writeHeadlines).toHaveBeenCalledTimes(2);
    expect(writeHeadlines.mock.calls[1]?.[0].workflow.activeRuns[0]).toMatchObject({ runId: 'a', recordRevision: '1' });
  });

  it('retries failed headline writes without rewriting committed records', async () => {
    const commitRecord = vi.fn(async (_snapshot: SessionWorkflowRunSnapshotV1) => {});
    const writeHeadlines = vi.fn(async (_bundle: SessionActivityHeadlineBundleV1) => {})
      .mockRejectedValueOnce(new Error('Server unavailable'));
    const publisher = createWorkflowActivityPublisher({ backendId: 'claude', commitRecord, writeHeadlines });
    const input = { snapshots: new Map([['a', runSnapshot()]]), changedRunIds: ['a'] };
    await expect(publisher.publish(input)).rejects.toThrow('Server unavailable');
    await publisher.publish(input);
    expect(commitRecord).toHaveBeenCalledTimes(1);
    expect(writeHeadlines).toHaveBeenCalledTimes(2);
    expect(writeHeadlines.mock.calls[1]?.[0].workflow.activeRuns[0]).toMatchObject({ runId: 'a' });
  });
});
