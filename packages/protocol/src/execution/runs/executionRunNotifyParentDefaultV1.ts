import type { ExecutionRunClass } from './runPrimitives.js';

/**
 * Whether a run reports back to the Session that started it when its start does not say
 * (`notifyParentOnCompletion` omitted).
 *
 * A bounded run — a review, a plan, a delegated task — was asked for on that Session's behalf, so its
 * result comes back. A long-lived side conversation stays beside the Session and follows the Account's
 * existing preference (`executionRunsNotifyParentOnCompletionDefault`, off unless the person turned it
 * on). One decision for the runtime default and for the start composer's "Report to this session" chip.
 */
export function resolveExecutionRunNotifyParentDefaultV1(input: Readonly<{
  runClass: ExecutionRunClass;
  accountDefault: boolean | null | undefined;
}>): boolean {
  return input.runClass === 'bounded' ? true : input.accountDefault === true;
}
