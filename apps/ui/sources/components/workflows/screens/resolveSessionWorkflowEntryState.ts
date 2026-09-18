import type { SessionRouteHydrationState } from '@/sync/domains/session/sessionRouteHydrationState';

/**
 * What a Session-origin Workflow entry can honestly say before it has captured
 * that Session's context.
 *
 * These are four different facts and the user acts on each differently: waiting
 * is not a failure, a deleted Session is not a refused one, and a Session whose
 * execution context cannot be read is not a transport problem. Collapsing them
 * into one spinner — or one blank screen — leaves a person with no way to tell
 * whether to wait, retry, or author the workflow somewhere else.
 */
export type SessionWorkflowEntryState =
    /** The canonical route hydration owner is still working. */
    | 'loading'
    /** Hydration failed retryably. That owner keeps retrying; so may the user. */
    | 'failed'
    /** The Session is not there: deleted, or not on this Home. */
    | 'missing'
    /** The Session exists but this device could not be authorized to read it. */
    | 'inaccessible'
    /** The Session is readable, but its current context cannot seed a workflow. */
    | 'unsupported';

export function resolveSessionWorkflowEntryState(input: Readonly<{
    hydration: SessionRouteHydrationState;
    /** Whether the Session snapshot itself has landed in the store. */
    hasSession: boolean;
}>): SessionWorkflowEntryState {
    switch (input.hydration.kind) {
        case 'missing':
            // `not_found` is the only cause that reports absence. The others are
            // authorization facts, and telling someone their Session was deleted
            // because a token expired would be a lie.
            return input.hydration.cause === 'not_found' ? 'missing' : 'inaccessible';
        case 'retrying':
            return 'failed';
        case 'loading':
            return 'loading';
        case 'available':
            // Hydration succeeded, so a missing snapshot is still in flight. A
            // present snapshot that produced no capture is the real refusal.
            return input.hasSession ? 'unsupported' : 'loading';
    }
}
