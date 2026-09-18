import type { ExecutionRunPublicState } from '@happier-dev/protocol';

/**
 * The interaction affordances a client may offer for one exact Execution Run.
 *
 * This is a projection of the run's own `interaction` field, which the daemon
 * emits only for a live controller created through the retained Agent Session
 * adapter. Absence means no live delivery controls; only the separate canonical
 * lifecycle projection may expose Resume. Clients must not infer either from
 * status, intent, run class, Agent id, or method presence — that inference is
 * what let bounded jobs and stale reconstructions paint invalid controls.
 */
export type ExecutionRunInteractionAffordances = Readonly<{
    /** The run is a live retained Agent conversation right now. */
    isRetainedAgentSession: boolean;
    /** A new turn may be admitted for this run. */
    canSend: boolean;
    /** The Agent declares native steering, so `steer_if_active`/`steer_now` are real. */
    canSteer: boolean;
    /** The Agent declares follow-up delivery within an active turn. */
    canFollowUp: boolean;
    /** The current turn may be cancelled through the retained cancel operation. */
    canCancelTurn: boolean;
    /** The provider Session may be resumed through the canonical resume owner. */
    canResume: boolean;
}>;

export const NO_EXECUTION_RUN_INTERACTION: ExecutionRunInteractionAffordances = Object.freeze({
    isRetainedAgentSession: false,
    canSend: false,
    canSteer: false,
    canFollowUp: false,
    canCancelTurn: false,
    canResume: false,
});

type ExecutionRunInteractionProjectionShape = Readonly<{
    status?: unknown;
    interaction?: unknown;
    lifecycle?: unknown;
}>;

function readLifecycleState(run: ExecutionRunInteractionProjectionShape): string | null {
    const lifecycle = run.lifecycle;
    if (!lifecycle || typeof lifecycle !== 'object') return null;
    if ((lifecycle as { v?: unknown }).v !== 1) return null;
    const state = (lifecycle as { state?: unknown }).state;
    return typeof state === 'string' ? state : null;
}

function readRetainedCapabilities(run: ExecutionRunInteractionProjectionShape): {
    open: readonly string[];
    delivery: readonly string[];
    cancel: boolean;
} | null {
    const interaction = run.interaction;
    if (!interaction || typeof interaction !== 'object') return null;
    if ((interaction as { kind?: unknown }).kind !== 'retained_agent_session.v1') return null;
    const capabilities = (interaction as { capabilities?: unknown }).capabilities;
    if (!capabilities || typeof capabilities !== 'object') return null;
    const open = (capabilities as { open?: unknown }).open;
    const delivery = (capabilities as { delivery?: unknown }).delivery;
    return {
        open: Array.isArray(open) ? open.filter((value): value is string => typeof value === 'string') : [],
        delivery: Array.isArray(delivery) ? delivery.filter((value): value is string => typeof value === 'string') : [],
        cancel: (capabilities as { cancel?: unknown }).cancel === true,
    };
}

/**
 * Resolve what this exact run currently supports.
 *
 * Live delivery requires the daemon's retained interaction plus a running Run.
 * Resume is separate: it appears only when the daemon lifecycle owner proves a
 * controller-less Run recoverable. A stale interaction or a client-side guess
 * from status/resumeHandle never creates either affordance.
 */
export function resolveExecutionRunInteractionAffordances(
    run: ExecutionRunInteractionProjectionShape | ExecutionRunPublicState | null | undefined,
): ExecutionRunInteractionAffordances {
    if (!run || typeof run !== 'object') return NO_EXECUTION_RUN_INTERACTION;
    const canResume = readLifecycleState(run) === 'recoverable';
    const capabilities = readRetainedCapabilities(run);
    if (!capabilities) {
        return canResume
            ? Object.freeze({ ...NO_EXECUTION_RUN_INTERACTION, canResume: true })
            : NO_EXECUTION_RUN_INTERACTION;
    }
    const status = typeof run.status === 'string' ? run.status.trim().toLowerCase() : '';
    if (status !== 'running') {
        return canResume
            ? Object.freeze({ ...NO_EXECUTION_RUN_INTERACTION, canResume: true })
            : NO_EXECUTION_RUN_INTERACTION;
    }
    return Object.freeze({
        isRetainedAgentSession: true,
        canSend: capabilities.delivery.includes('newTurn'),
        canSteer: capabilities.delivery.includes('steer'),
        canFollowUp: capabilities.delivery.includes('followUp'),
        canCancelTurn: capabilities.cancel,
        // A current controller is already open. Resume is offered only when the
        // daemon's lifecycle owner proves a controller-less Run recoverable.
        canResume,
    });
}
