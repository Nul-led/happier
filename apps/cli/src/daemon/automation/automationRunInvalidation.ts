import { isAuthoritativeAutomationRunCancellationCauseV1 } from '@happier-dev/protocol/plugins/events/hostReferencesV1';

import type { Update } from '@/api/types';
import { abortAutomationRunForAuthoritativeCancellation } from './automationRunCancellation';

export type ActiveAutomationRun = Readonly<{
  runId: string;
  attempt: number;
  controller?: AbortController;
  refreshReviewHolds?: () => void;
}>;

export type AutomationRunInvalidationAction = 'none' | 'abort' | 'authoritative-cancellation' | 'review-resolved';

type AutomationRunInvalidation = Readonly<{
  runId: string;
  state: Extract<Update['body'], Readonly<{ t: 'automation-run-updated' }>>['state'];
  machineId: string | null | undefined;
  attempt: number | undefined;
  transitionCause: string | undefined;
}>;

function getAutomationRunInvalidation(update: Update): AutomationRunInvalidation | null {
  const body = update.body;
  if (body.t === 'automation-run-updated') {
    return {
      runId: body.runId,
      state: body.state,
      machineId: body.machineId,
      attempt: body.attempt,
      transitionCause: undefined,
    };
  }
  if (body.t === 'automation-run-state-changed') {
    return {
      runId: body.runId,
      state: body.currentState,
      machineId: body.claimedByMachineId,
      attempt: undefined,
      transitionCause: body.transitionCause,
    };
  }
  return null;
}

/**
 * Determines whether one authoritative Run update has made this machine's
 * incumbent Run attempt stale. The worker remains the only owner that applies
 * the resulting abort to its invocation-local controller.
 */
export function getAutomationRunInvalidationAction(params: Readonly<{
  update: Update;
  active: ActiveAutomationRun | null;
  machineId: string;
}>): AutomationRunInvalidationAction {
  const invalidation = getAutomationRunInvalidation(params.update);
  if (invalidation === null || params.active === null || params.active.runId !== invalidation.runId) {
    return 'none';
  }

  const body = params.update.body;
  if (body.t === 'automation-run-updated' && (body.workflowControl === 'cancel_requested' || body.workflowControl === 'review_resolved')) {
    // A targeted control hint belongs only to the named claim. Stale hints
    // cannot cancel or invalidate a newer same-machine reclaim.
    return body.targetMachineId === params.machineId
      && body.machineId === params.machineId
      && body.attempt === params.active.attempt
      ? body.workflowControl === 'review_resolved' ? 'review-resolved' : 'authoritative-cancellation'
      : 'none';
  }

  const stateIsCurrent = invalidation.state === 'claimed' || invalidation.state === 'running';
  const machineIsCurrent = invalidation.machineId === params.machineId;
  // Older Run updates and the bounded lifecycle Host Event omit the attempt.
  // Their lifecycle state/machine check still invalidates only stale execution;
  // current Run updates additionally fence same-machine reclaim.
  const attemptIsCurrent = invalidation.attempt === undefined
    || invalidation.attempt === params.active.attempt;
  if (stateIsCurrent && machineIsCurrent && attemptIsCurrent) return 'none';

  // A Run cancelled once its target could already be doing work can only be
  // published as uncertain: the server cannot claim an outcome nothing
  // established. The explicit transition cause is what still makes the user's
  // cancellation authoritative here, so this machine stops the execution it
  // started and discards the exact Automation input it enqueued instead of
  // merely abandoning a stale attempt. The Protocol owns which causes carry
  // that authority; any other uncertainty stays a generic abort.
  const authoritativelyCancelled = invalidation.state === 'cancelled'
    || (
      invalidation.state === 'outcome_uncertain'
      && isAuthoritativeAutomationRunCancellationCauseV1(invalidation.transitionCause)
    );
  return authoritativelyCancelled ? 'authoritative-cancellation' : 'abort';
}

/** Applies the worker's one invocation-local currentness decision. */
export function invalidateActiveAutomationRun(params: Readonly<{
  update: Update;
  active: ActiveAutomationRun | null;
  machineId: string;
}>): AutomationRunInvalidationAction {
  const action = getAutomationRunInvalidationAction(params);
  if (action === 'review-resolved') {
    params.active?.refreshReviewHolds?.();
    return action;
  }
  const controller = params.active?.controller;
  if (!controller) return action;
  if (action === 'authoritative-cancellation') {
    abortAutomationRunForAuthoritativeCancellation(controller);
  } else if (action === 'abort') {
    controller.abort();
  }
  return action;
}
