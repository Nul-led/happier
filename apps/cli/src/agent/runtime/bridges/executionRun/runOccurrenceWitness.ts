import type { AgentInvocationTurnAdmissionWitness } from '@/plugins/runtime/invocation/services/types';
import type {
    ExecutionRunBackendController,
    ExecutionRunController,
    ExecutionRunControllerOccurrenceV1,
} from '@/agent/executionRuns/controllers/types';

/**
 * The exact live occurrence of one Session-owned Execution Run.
 *
 * A resume, restart, or controller replacement produces a new occurrence. A
 * superseded occurrence stops being current and can never supply the live turn's
 * authority again, so two simultaneously active turns cannot borrow each other's
 * witness.
 */
export type ExecutionRunOccurrenceWitnessV1 = ExecutionRunControllerOccurrenceV1;

/**
 * A Session-lifetime reader over the current Run occurrences.
 *
 * Consumers that are rebuilt per request — for example a per-HTTP/RPC MCP server —
 * hold this stable reader instead of capturing a controller, so they always
 * resolve the exact occurrence that is current at call time.
 */
export type ExecutionRunOccurrenceWitnessReaderV1 = Readonly<{
    readCurrentRunOccurrence: (runId: string) => ExecutionRunOccurrenceWitnessV1 | null;
}>;

export type ExecutionRunOccurrenceRegistration = Readonly<{
    occurrence: ExecutionRunOccurrenceWitnessV1;
    /** Retire this exact occurrence. Disposing a superseded one never retires the live one. */
    dispose: () => void;
}>;

export type ExecutionRunOccurrenceWitnessRegistry = Readonly<{
    reader: ExecutionRunOccurrenceWitnessReaderV1;
    register: (params: Readonly<{
        runId: string;
        sidechainId: string;
        controller: ExecutionRunBackendController;
        runtimeLifetimeSignal: AbortSignal;
        /**
         * The native Session runtime's own liveness. Once disposal starts, the
         * occurrence stops being current immediately — it does not wait for
         * controller settlement to retire the registration.
         */
        isRuntimeLive?: () => boolean;
        readActiveTurnAdmissionWitness: () => AgentInvocationTurnAdmissionWitness | null;
    }>) => ExecutionRunOccurrenceRegistration;
}>;

/**
 * Stable occurrence identities projected from the canonical controller map.
 *
 * It holds no permission decision, Account identity, or approval policy.
 * It does not own currentness: every answer is derived from the exact controller
 * entry plus that controller's runtime lifetime.
 */
export function createExecutionRunOccurrenceWitnessRegistry(
    controllers: ReadonlyMap<string, ExecutionRunController>,
): ExecutionRunOccurrenceWitnessRegistry {
    const reader: ExecutionRunOccurrenceWitnessReaderV1 = Object.freeze({
        readCurrentRunOccurrence: (runId) => {
            const controller = controllers.get(runId);
            const occurrence = controller?.kind === 'backend'
                ? controller.executionRunOccurrence
                : undefined;
            return occurrence && occurrence.isCurrent() ? occurrence : null;
        },
    });

    return Object.freeze({
        reader,
        register: (params) => {
            const occurrenceId = params.controller.controllerOccurrenceId;
            const isCurrent = (): boolean => controllers.get(params.runId) === params.controller
                && params.controller.executionRunOccurrence === occurrence
                && !params.runtimeLifetimeSignal.aborted
                && (params.isRuntimeLive?.() ?? true);
            const occurrence: ExecutionRunOccurrenceWitnessV1 = Object.freeze({
                runId: params.runId,
                sidechainId: params.sidechainId,
                occurrenceId,
                runtimeLifetimeSignal: params.runtimeLifetimeSignal,
                isCurrent,
                readActiveTurnAdmissionWitness: () => (
                    isCurrent() ? params.readActiveTurnAdmissionWitness() : null
                ),
            });
            params.controller.executionRunOccurrence = occurrence;
            return Object.freeze({
                occurrence,
                dispose: () => {
                    if (params.controller.executionRunOccurrence === occurrence) {
                        delete params.controller.executionRunOccurrence;
                    }
                },
            });
        },
    });
}
