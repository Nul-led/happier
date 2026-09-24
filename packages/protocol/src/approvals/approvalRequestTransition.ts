import { ActionIdSchema } from '../actions/actionIds.js';
import { getActionSpec } from '../actions/actionSpecs.js';
import { sameStrictJsonValue } from '../json/strictJsonValue.js';
import type { ApprovalRequest } from './approvalRequestV1.js';

/**
 * The one approval subject/transition contract for built-in approval Artifacts.
 *
 * Every Artifact adapter (the CLI/daemon store and the UI writer) asks this
 * owner whether a proposed body may replace the stored one, then commits it with
 * the revision it read (Artifact CAS). The immutable subject is everything except
 * the lifecycle fields; the lifecycle is
 *
 *   open -> approved -> executing -> executed | failed
 *   open -> rejected | canceled
 *   approved -> failed            (definitive pre-execution failure)
 *
 * The admitted operands (`actionArgs`) stay immutable through open, approved and
 * executing, because deferred replay reads them. A settlement is the one
 * exception: it replaces them with this Action's own declared observation
 * projection (`settleApprovalRequestActionArgs`), never with caller-authored
 * arguments, so no durable history keeps write-only secrets after replay.
 */

type ApprovalRequestStatus = ApprovalRequest['status'];

const SETTLED_STATUSES: ReadonlySet<ApprovalRequestStatus> = new Set([
  'rejected',
  'canceled',
  'executed',
  'failed',
]);

function isSettled(status: ApprovalRequestStatus): boolean {
  return SETTLED_STATUSES.has(status);
}

/**
 * The operands a settled approval durably keeps: the Action's declared
 * `projectObservationInput` of the admitted input. A request that is already
 * settled, an Action with live-only input custody (its record already holds that
 * projection since creation), a historical Action id with no current spec, and
 * an Action without a projection keep their stored operands unchanged, so the
 * projection is applied exactly once and never to its own output.
 */
export function settleApprovalRequestActionArgs(request: ApprovalRequest): unknown {
  if (isSettled(request.status)) return request.actionArgs;
  const actionId = ActionIdSchema.safeParse(request.actionId);
  if (!actionId.success) return request.actionArgs;
  const spec = getActionSpec(actionId.data);
  if (spec.approvalInputCustody === 'live_only' || !spec.projectObservationInput) return request.actionArgs;
  return spec.projectObservationInput(request.actionArgs);
}

/** Compare the JSON both adapters actually persist (absent and `undefined` fields agree). */
function durablyEqual(left: unknown, right: unknown): boolean {
  const durable = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return sameStrictJsonValue(durable(left), durable(right));
}

function immutableSubject(request: ApprovalRequest, actionArgs: unknown): Readonly<Record<string, unknown>> {
  const {
    status: _status,
    updatedAtMs: _updatedAtMs,
    decision: _decision,
    execution: _execution,
    actionArgs: _actionArgs,
    ...subject
  } = request;
  return { ...subject, actionArgs };
}

export type ApprovalRequestTransitionDecision =
  | Readonly<{ ok: true; changed: boolean }>
  | Readonly<{ ok: false; errorCode: 'subject_mismatch'; error: 'approval_request_subject_mismatch' }>
  | Readonly<{ ok: false; errorCode: 'invalid_transition'; error: 'approval_request_invalid_transition' }>;

const SUBJECT_MISMATCH = {
  ok: false,
  errorCode: 'subject_mismatch',
  error: 'approval_request_subject_mismatch',
} as const;

const INVALID_TRANSITION = {
  ok: false,
  errorCode: 'invalid_transition',
  error: 'approval_request_invalid_transition',
} as const;

/**
 * Decide whether `next` may replace the stored `existing` request. `changed:
 * false` is an idempotent repeat of a non-claiming write; an identical
 * `executing` write is refused so a second executor can never believe it won the
 * effect claim.
 */
export function decideApprovalRequestTransition(
  existing: ApprovalRequest,
  next: ApprovalRequest,
): ApprovalRequestTransitionDecision {
  const settling = !isSettled(existing.status) && isSettled(next.status);
  const expectedActionArgs = settling ? settleApprovalRequestActionArgs(existing) : existing.actionArgs;
  if (!durablyEqual(immutableSubject(existing, expectedActionArgs), immutableSubject(next, next.actionArgs))) {
    return SUBJECT_MISMATCH;
  }
  if (durablyEqual(existing, next)) {
    return existing.status === 'executing' ? INVALID_TRANSITION : { ok: true, changed: false };
  }
  const isOpenDecision = existing.status === 'open'
    && (next.status === 'approved' || next.status === 'rejected' || next.status === 'canceled');
  // Only current V2 carries the executing claim. Released ApprovalRequestV1
  // has terminal execution results, but no intermediate `executing` state.
  const isApprovedExecution = existing.v === 2
    && existing.status === 'approved'
    && next.v === 2
    && next.status === 'executing'
    && next.decision?.kind === 'approve'
    && next.execution === undefined;
  // A definitive replay-currentness/context failure happens before an Action
  // effect starts, so it settles an approved V2 request directly.
  const isApprovedPreExecutionFailure = existing.v === 2
    && existing.status === 'approved'
    && next.v === 2
    && next.status === 'failed'
    && next.decision?.kind === 'approve'
    && next.execution?.ok === false;
  // Released V1 has no replay authority or executing claim; the decision owner
  // may only close an approved V1 request with the fixed non-effectful stale
  // tombstone.
  const isLegacyApprovedStaleFailure = existing.v === 1
    && existing.status === 'approved'
    && next.v === 1
    && next.status === 'failed'
    && next.decision?.kind === 'approve'
    && next.execution?.ok === false
    && next.execution.errorCode === 'approval_stale'
    && next.execution.error === 'approval_stale';
  const isExecutingTerminal = existing.v === 2
    && existing.status === 'executing'
    && (next.status === 'executed' || next.status === 'failed')
    && next.decision?.kind === 'approve'
    && next.execution !== undefined;
  if (
    (!isOpenDecision
      && !isApprovedExecution
      && !isApprovedPreExecutionFailure
      && !isLegacyApprovedStaleFailure
      && !isExecutingTerminal)
    || next.updatedAtMs < existing.updatedAtMs
  ) {
    return INVALID_TRANSITION;
  }
  return { ok: true, changed: true };
}
