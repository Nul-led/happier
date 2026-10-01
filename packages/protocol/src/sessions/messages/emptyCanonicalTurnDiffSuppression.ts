import { hasCanonicalTurnDiffEvidence, isCanonicalTurnDiffPayload } from './canonicalTurnDiffTool.js';

export type EmptyCanonicalTurnDiffSuppressionState = Readonly<{
  suppressedEmptyCanonicalTurnDiffCallIds: Set<string>;
}>;

// Retains the existing transcript normalization window, with refreshed ids kept newest.
const MAX_SUPPRESSED_CALL_IDS = 256;

export function createEmptyCanonicalTurnDiffSuppressionState(): EmptyCanonicalTurnDiffSuppressionState {
  return { suppressedEmptyCanonicalTurnDiffCallIds: new Set<string>() };
}

export function rememberSuppressedEmptyCanonicalTurnDiffCallId(
  state: EmptyCanonicalTurnDiffSuppressionState,
  callId: string,
): void {
  const ids = state.suppressedEmptyCanonicalTurnDiffCallIds;
  ids.delete(callId);
  while (ids.size >= MAX_SUPPRESSED_CALL_IDS) {
    const oldest = ids.keys().next().value;
    if (oldest === undefined) break;
    ids.delete(oldest);
  }
  ids.add(callId);
}

/** Consume a result once, or defer consumption until every block in its row was inspected. */
export function shouldSuppressEmptyCanonicalTurnDiffToolResult(
  state: EmptyCanonicalTurnDiffSuppressionState,
  callId: string,
  output: unknown,
  consumedCallIds?: Set<string>,
): boolean {
  const known = state.suppressedEmptyCanonicalTurnDiffCallIds.has(callId);
  if (known) {
    if (consumedCallIds) consumedCallIds.add(callId);
    else state.suppressedEmptyCanonicalTurnDiffCallIds.delete(callId);
  }
  return (known || isCanonicalTurnDiffPayload(output)) && !hasCanonicalTurnDiffEvidence(output);
}
