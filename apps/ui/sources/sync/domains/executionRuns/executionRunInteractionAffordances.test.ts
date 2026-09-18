import { describe, expect, it } from 'vitest';

import {
    NO_EXECUTION_RUN_INTERACTION,
    resolveExecutionRunInteractionAffordances,
} from './executionRunInteractionAffordances';

function retained(capabilities: Record<string, unknown>) {
    return {
        kind: 'retained_agent_session.v1',
        capabilities: {
            open: ['create'],
            delivery: ['newTurn'],
            cancel: false,
            ...capabilities,
        },
    };
}

describe('resolveExecutionRunInteractionAffordances', () => {
    it('projects live delivery and cancellation without offering Resume for the current controller', () => {
        expect(resolveExecutionRunInteractionAffordances({
            status: 'running',
            lifecycle: { v: 1, state: 'current' },
            interaction: retained({
                open: ['create', 'resume'],
                delivery: ['newTurn', 'steer', 'followUp'],
                cancel: true,
            }),
        })).toEqual({
            isRetainedAgentSession: true,
            canSend: true,
            canSteer: true,
            canFollowUp: true,
            canCancelTurn: true,
            canResume: false,
        });
    });

    it('offers Resume only for a daemon-proven recoverable lifecycle, not a current controller', () => {
        expect(resolveExecutionRunInteractionAffordances({
            status: 'succeeded',
            lifecycle: { v: 1, state: 'recoverable' },
        })).toEqual({
            ...NO_EXECUTION_RUN_INTERACTION,
            canResume: true,
        });

        expect(resolveExecutionRunInteractionAffordances({
            status: 'succeeded',
            lifecycle: { v: 1, state: 'recoverable_with_input' },
        })).toEqual(NO_EXECUTION_RUN_INTERACTION);
    });

    it('withholds steer, follow-up, cancel and resume the Agent never declared', () => {
        expect(resolveExecutionRunInteractionAffordances({
            status: 'running',
            interaction: retained({}),
        })).toEqual({
            isRetainedAgentSession: true,
            canSend: true,
            canSteer: false,
            canFollowUp: false,
            canCancelTurn: false,
            canResume: false,
        });
    });

    it('is read-only without a projected interaction, however long-lived the run looks', () => {
        // The exact shape a transcript reconstruction or daemon fallback produces: a
        // running long-lived streaming delegate with no live retained controller behind it.
        expect(resolveExecutionRunInteractionAffordances({
            status: 'running',
            intent: 'delegate',
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            ioMode: 'streaming',
            turnInFlight: false,
        })).toEqual(NO_EXECUTION_RUN_INTERACTION);
    });

    it('is read-only once the run is no longer running even if its last state carried an interaction', () => {
        expect(resolveExecutionRunInteractionAffordances({
            status: 'completed',
            interaction: retained({ delivery: ['newTurn', 'steer'], cancel: true }),
        })).toEqual(NO_EXECUTION_RUN_INTERACTION);
    });

    it('rejects an unknown interaction kind rather than treating it as retained', () => {
        expect(resolveExecutionRunInteractionAffordances({
            status: 'running',
            interaction: { kind: 'something_else.v1', capabilities: { delivery: ['newTurn'] } },
        })).toEqual(NO_EXECUTION_RUN_INTERACTION);
    });

    it('is read-only for a missing run', () => {
        expect(resolveExecutionRunInteractionAffordances(null)).toEqual(NO_EXECUTION_RUN_INTERACTION);
        expect(resolveExecutionRunInteractionAffordances(undefined)).toEqual(NO_EXECUTION_RUN_INTERACTION);
    });
});
