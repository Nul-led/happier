import { describe, expect, it, vi } from 'vitest';

import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';

import { cancelCurrentExecutionRunTurn } from './cancelCurrentExecutionRunTurn';
import type { ExecutionRunState } from './executionRunTypes';
import type { ExecutionRunOccurrenceWitnessReaderV1 } from './runOccurrenceWitness';
import { createTestExecutionRunHostRuntime } from './testkit';

describe('cancelCurrentExecutionRunTurn', () => {
  it('cancels once only for the exact current occurrence and active turn without terminalizing the Run', async () => {
    const cancel = vi.fn(async () => {});
    const runtime = createTestExecutionRunHostRuntime({ onCancel: cancel });
    const controller = {
      kind: 'backend',
      backend: {
        ...runtime,
        interaction: {
          kind: 'retained_agent_session.v1',
          capabilities: { open: ['create', 'resume'], delivery: ['newTurn'], cancel: true },
        },
      },
      runtimeId: 'run-a',
      cancelled: false,
      turnInFlight: true,
      turnEpoch: 4,
      turnCancelReason: null,
      turnCancelEpoch: null,
      currentInputTurn: { turnId: 'turn-a', inputIds: ['input-a'], state: 'active' },
    } as unknown as ExecutionRunController;
    const runs = new Map<string, ExecutionRunState>([[
      'run-a',
      { runId: 'run-a', status: 'running' } as ExecutionRunState,
    ]]);
    const controllers = new Map([['run-a', controller]]);
    const occurrenceReader: ExecutionRunOccurrenceWitnessReaderV1 = {
      readCurrentRunOccurrence: () => ({ occurrenceId: 'occurrence-a' }) as unknown as NonNullable<ReturnType<
        ExecutionRunOccurrenceWitnessReaderV1['readCurrentRunOccurrence']
      >>,
    };
    const input = {
      runId: 'run-a', occurrenceId: 'occurrence-a', turnId: 'turn-a', runs, controllers, occurrenceReader,
    };

    await expect(cancelCurrentExecutionRunTurn(input)).resolves.toMatchObject({ ok: true, status: 'requested' });
    await expect(cancelCurrentExecutionRunTurn(input)).resolves.toMatchObject({ ok: true, status: 'already_requested' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(runs.get('run-a')?.status).toBe('running');

    await expect(cancelCurrentExecutionRunTurn({ ...input, occurrenceId: 'stale' }))
      .resolves.toMatchObject({ ok: false, errorCode: 'execution_run_not_current' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
