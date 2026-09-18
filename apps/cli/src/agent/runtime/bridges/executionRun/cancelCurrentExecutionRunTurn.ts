import type { ExecutionRunCancelTurnResponse } from '@happier-dev/protocol';

import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';

import type { ExecutionRunState } from './executionRunTypes';
import type { ExecutionRunOccurrenceWitnessReaderV1 } from './runOccurrenceWitness';

export async function cancelCurrentExecutionRunTurn(params: Readonly<{
  runId: string;
  occurrenceId: string;
  turnId: string;
  runs: ReadonlyMap<string, ExecutionRunState>;
  controllers: ReadonlyMap<string, ExecutionRunController>;
  occurrenceReader: ExecutionRunOccurrenceWitnessReaderV1;
}>): Promise<ExecutionRunCancelTurnResponse> {
  const run = params.runs.get(params.runId) ?? null;
  if (!run) {
    return { ok: false, errorCode: 'execution_run_not_found', error: 'Execution run was not found' };
  }
  const controller = params.controllers.get(params.runId) ?? null;
  const occurrence = params.occurrenceReader.readCurrentRunOccurrence(params.runId);
  if (
    run.status !== 'running'
    || !controller
    || controller.kind !== 'backend'
    || !occurrence
    || occurrence.occurrenceId !== params.occurrenceId
  ) {
    return { ok: false, errorCode: 'execution_run_not_current', error: 'Execution run occurrence is no longer current' };
  }
  const turn = controller.currentInputTurn;
  if (!controller.turnInFlight || !turn || turn.state !== 'active' || turn.turnId !== params.turnId) {
    return { ok: false, errorCode: 'execution_run_turn_not_active', error: 'Execution run turn is no longer active' };
  }
  if (controller.backend.interaction?.capabilities.cancel !== true || !controller.runtimeId) {
    return { ok: false, errorCode: 'execution_run_cancel_unsupported', error: 'Execution run turn cancellation is unavailable' };
  }
  if (controller.turnCancelReason === 'cancel' && controller.turnCancelEpoch === controller.turnEpoch) {
    return {
      ok: true,
      status: 'already_requested',
      runId: params.runId,
      occurrenceId: params.occurrenceId,
      turnId: params.turnId,
    };
  }
  controller.turnCancelReason = 'cancel';
  controller.turnCancelEpoch = controller.turnEpoch;
  try {
    await controller.backend.cancel(controller.runtimeId);
  } catch (error) {
    if (controller.turnCancelReason === 'cancel' && controller.turnCancelEpoch === controller.turnEpoch) {
      controller.turnCancelReason = null;
      controller.turnCancelEpoch = null;
    }
    return {
      ok: false,
      errorCode: 'execution_run_cancel_failed',
      error: error instanceof Error ? error.message : 'Execution run turn cancellation failed',
    };
  }
  return {
    ok: true,
    status: 'requested',
    runId: params.runId,
    occurrenceId: params.occurrenceId,
    turnId: params.turnId,
  };
}
