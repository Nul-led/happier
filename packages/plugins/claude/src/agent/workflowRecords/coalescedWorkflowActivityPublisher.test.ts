import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_WORKFLOW_RUN_SNAPSHOT_PROJECTION_VERSION,
  type SessionWorkflowRunSnapshotV1,
} from '@happier-dev/plugin-sdk/sessions/work-state';

import { createCoalescedWorkflowActivityPublisher } from './coalescedWorkflowActivityPublisher.js';
import type { WorkflowActivityPublishInput } from './publishWorkflowActivitySnapshot.js';
import { createWorkflowActivityPublisher } from './publishWorkflowActivitySnapshot.js';

function runSnapshot(runId: string): SessionWorkflowRunSnapshotV1 {
  return {
    v: 1,
    projectionVersion: SESSION_WORKFLOW_RUN_SNAPSHOT_PROJECTION_VERSION,
    runId,
    backendId: 'claude',
    title: `Run ${runId}`,
    status: 'active',
    recordRevision: '1',
    updatedAt: 1000,
    totalAgents: 1,
    completedAgents: 0,
    phases: [],
    agents: [],
  };
}

describe('createCoalescedWorkflowActivityPublisher', () => {
  it('flush leaves failed durable writes on the delayed retry path instead of retrying in a tight loop', async () => {
    let available = false;
    const records: SessionWorkflowRunSnapshotV1[] = [];
    const headlines: string[][] = [];
    const publisher = createWorkflowActivityPublisher({
      backendId: 'claude',
      commitRecord: async (snapshot) => {
        records.push(snapshot);
        if (!available) throw new Error('Server unavailable');
      },
      writeHeadlines: (bundle) => { headlines.push(bundle.workflow.activeRuns.map((run) => run.runId)); },
    });
    const scheduler = createCoalescedWorkflowActivityPublisher({
      publisher,
      getSnapshots: () => new Map([['a', runSnapshot('a')]]),
      debounceMs: 300,
    });

    scheduler.notify({ changedRunIds: ['a'], startedRunIds: [], terminalRunIds: [], statusChangedRunIds: [] });
    await scheduler.flush();
    expect(records).toHaveLength(1);
    expect(headlines).toEqual([[]]);
    await vi.advanceTimersByTimeAsync(299);
    expect(records).toHaveLength(1);

    available = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(records).toHaveLength(2);
    expect(headlines).toEqual([[], ['a']]);
    scheduler.dispose();
  });


  it.each(['active', 'complete'] as const)('serializes a %s notification arriving during a flush-driven record write', async (status) => {
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const records: SessionWorkflowRunSnapshotV1[] = [];
    const headlines: string[][] = [];
    const snapshots = new Map([['a', runSnapshot('a')]]);
    const publisher = createWorkflowActivityPublisher({
      backendId: 'claude',
      commitRecord: async (snapshot) => {
        records.push(snapshot);
        if (records.length === 1) await firstWrite;
      },
      writeHeadlines: (bundle) => { headlines.push((bundle.workflow.recentRuns ?? []).map((run) => run.runId)); },
    });
    const scheduler = createCoalescedWorkflowActivityPublisher({ publisher, getSnapshots: () => snapshots });
    scheduler.notify({ changedRunIds: ['a'], startedRunIds: [], terminalRunIds: [], statusChangedRunIds: [] });
    const flush = scheduler.flush();
    await vi.advanceTimersByTimeAsync(0);
    snapshots.set('a', { ...{ ...runSnapshot('a'), status }, updatedAt: 2000, totalAgents: 2 });
    scheduler.notify({ changedRunIds: ['a'], startedRunIds: [], terminalRunIds: status === 'complete' ? ['a'] : [], statusChangedRunIds: [] });
    await vi.advanceTimersByTimeAsync(0);
    const writesBeforeRelease = records.length;
    releaseFirstWrite();
    await flush;
    expect(writesBeforeRelease).toBe(1);
    expect(records.map((record) => record.status)).toEqual(['active', status]);
    expect(headlines.at(-1)).toEqual(status === 'complete' ? ['a'] : []);
    scheduler.dispose();
  });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('requeues failed run ids returned by the publisher for a delayed retry', async () => {
    const publishes: WorkflowActivityPublishInput[] = [];
    let attempt = 0;
    const publisher = {
      publish: vi.fn(async (input: WorkflowActivityPublishInput) => {
        publishes.push(input);
        attempt += 1;
        return { failedRunIds: attempt === 1 ? ['a'] : [], permanentFailedRunIds: [] };
      }),
    };
    const scheduler = createCoalescedWorkflowActivityPublisher({
      publisher,
      getSnapshots: () => new Map([['a', runSnapshot('a')]]),
      debounceMs: 300,
    });

    scheduler.notify({ changedRunIds: ['a'], startedRunIds: [], terminalRunIds: ['a'], statusChangedRunIds: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(299);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(publishes[1]?.changedRunIds).toEqual(['a']);
  });

  it('flush waits for an immediate in-flight publish and drains changes queued behind it', async () => {
    let releaseFirstPublish!: () => void;
    const firstPublish = new Promise<void>((resolve) => {
      releaseFirstPublish = resolve;
    });
    const publisher = {
      publish: vi.fn(async (input: WorkflowActivityPublishInput) => {
        if (publisher.publish.mock.calls.length === 1) await firstPublish;
        return { failedRunIds: [], permanentFailedRunIds: [] };
      }),
    };
    const scheduler = createCoalescedWorkflowActivityPublisher({
      publisher,
      getSnapshots: () => new Map([
        ['a', runSnapshot('a')],
        ['b', runSnapshot('b')],
      ]),
      debounceMs: 300,
    });

    scheduler.notify({ changedRunIds: ['a'], startedRunIds: ['a'], terminalRunIds: [], statusChangedRunIds: [] });
    scheduler.notify({ changedRunIds: ['b'], startedRunIds: [], terminalRunIds: [], statusChangedRunIds: [] });
    let flushed = false;
    const flushPromise = scheduler.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    releaseFirstPublish();
    await flushPromise;

    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(publisher.publish.mock.calls[1]?.[0].changedRunIds).toEqual(['b']);
    scheduler.dispose();
  });
});
