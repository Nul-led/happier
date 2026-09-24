/**
 * One rule for every Follow editor: a mutation that failed keeps the user's exact intent until it
 * is retried successfully or explicitly abandoned.
 *
 * A passive refresh — an AccountChange wake, a reconnect, a list reload — reconciles the confirmed
 * server baseline *beneath* an outstanding failed intent and never erases it. Without that rule an
 * editor reaches two invalid states that were both live defects: an error row with nothing left to
 * retry, and an error row that silently disappears while the change the user asked for never
 * happened (the relation is still active, the preference is still the old one).
 *
 * The intent itself is opaque here: each editor owns its own transport and its own operation
 * vocabulary (an auto-follow preference set, a source removal, a mode change), and only the retry
 * semantics are shared.
 */
export type SessionFollowMutationIntentState<TIntent, TError = true> = Readonly<{
    /** In flight right now. */
    pending: TIntent | null;
    /** Failed and still retryable. */
    failed: TIntent | null;
    error: TError | null;
}>;

export type SessionFollowMutationIntentEvent<TIntent, TError = true> =
    | Readonly<{ kind: 'started'; intent: TIntent }>
    | Readonly<{ kind: 'succeeded' }>
    | Readonly<{ kind: 'failed'; error: TError }>
    /** A passive read settled: adopt the baseline, keep any outstanding failed intent. */
    | Readonly<{ kind: 'refreshed' }>
    /** The user abandoned the change, or the target stopped existing for this viewer. */
    | Readonly<{ kind: 'abandoned' }>;

export function createIdleSessionFollowMutationIntent<TIntent, TError = true>(
): SessionFollowMutationIntentState<TIntent, TError> {
    return { pending: null, failed: null, error: null };
}

export function reduceSessionFollowMutationIntent<TIntent, TError = true>(
    state: SessionFollowMutationIntentState<TIntent, TError>,
    event: SessionFollowMutationIntentEvent<TIntent, TError>,
): SessionFollowMutationIntentState<TIntent, TError> {
    switch (event.kind) {
        case 'started':
            return { pending: event.intent, failed: null, error: null };
        case 'succeeded':
            return { pending: null, failed: null, error: null };
        case 'failed':
            return { pending: null, failed: state.pending ?? state.failed, error: event.error };
        case 'refreshed':
            return state.failed === null && state.error === null
                ? state
                : state.failed === null
                    ? { pending: state.pending, failed: null, error: null }
                    : state;
        case 'abandoned':
            return createIdleSessionFollowMutationIntent<TIntent, TError>();
    }
}
