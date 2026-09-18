import { describe, expect, it } from 'vitest';

import { createExecutionRunOccurrenceWitnessRegistry } from './runOccurrenceWitness';
import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';

const witnessA = {
    inputId: 'input-1',
    turnId: 'turn-1',
    userMessageSeq: 7,
    userMessageSeqs: [7],
    callerPermissionMode: 'read-only' as const,
};

/** The native runtime lifetime every registration is bound to. */
function liveRuntimeSignal(): AbortSignal {
    return new AbortController().signal;
}

describe('createExecutionRunOccurrenceWitnessRegistry', () => {
    it('is a stable Session-lifetime reader that resolves the exact current occurrence', () => {
        const controllers = new Map<string, ExecutionRunController>();
        const controller = { kind: 'backend', controllerOccurrenceId: 'occurrence-a' } as ExecutionRunController;
        controllers.set('run-a', controller);
        const registry = createExecutionRunOccurrenceWitnessRegistry(controllers);
        const reader = registry.reader;

        // Held across recreated per-request servers: the reader identity never changes.
        expect(registry.reader).toBe(reader);
        expect(reader.readCurrentRunOccurrence('run-a')).toBeNull();

        const registration = registry.register({
            runId: 'run-a',
            sidechainId: 'chain-a',
            runtimeLifetimeSignal: liveRuntimeSignal(),
            controller: controller as Extract<ExecutionRunController, { kind: 'backend' }>,
            readActiveTurnAdmissionWitness: () => witnessA,
        });

        const occurrence = reader.readCurrentRunOccurrence('run-a');
        expect(occurrence).toMatchObject({
            runId: 'run-a',
            sidechainId: 'chain-a',
            occurrenceId: 'occurrence-a',
        });
        expect(occurrence?.isCurrent()).toBe(true);
        expect(occurrence?.readActiveTurnAdmissionWitness()).toEqual(witnessA);
        expect(reader.readCurrentRunOccurrence('run-b')).toBeNull();

        registration.dispose();
        expect(reader.readCurrentRunOccurrence('run-a')).toBeNull();
        expect(occurrence?.isCurrent()).toBe(false);
        expect(occurrence?.readActiveTurnAdmissionWitness()).toBeNull();
    });

    it('gives a resumed occurrence a distinct identity and retires the superseded one', () => {
        const controllers = new Map<string, ExecutionRunController>();
        const firstController = {
            kind: 'backend',
            controllerOccurrenceId: 'occurrence-first',
        } as ExecutionRunController;
        controllers.set('run-a', firstController);
        const registry = createExecutionRunOccurrenceWitnessRegistry(controllers);
        const first = registry.register({
            runId: 'run-a',
            sidechainId: 'chain-a',
            runtimeLifetimeSignal: liveRuntimeSignal(),
            controller: firstController as Extract<ExecutionRunController, { kind: 'backend' }>,
            readActiveTurnAdmissionWitness: () => witnessA,
        });
        const firstOccurrence = registry.reader.readCurrentRunOccurrence('run-a');

        const secondController = {
            kind: 'backend',
            controllerOccurrenceId: 'occurrence-second',
        } as ExecutionRunController;
        controllers.set('run-a', secondController);
        const second = registry.register({
            runId: 'run-a',
            sidechainId: 'chain-a',
            runtimeLifetimeSignal: liveRuntimeSignal(),
            controller: secondController as Extract<ExecutionRunController, { kind: 'backend' }>,
            readActiveTurnAdmissionWitness: () => ({ ...witnessA, turnId: 'turn-2' }),
        });
        const secondOccurrence = registry.reader.readCurrentRunOccurrence('run-a');

        expect(secondOccurrence?.occurrenceId).not.toBe(firstOccurrence?.occurrenceId);
        expect(firstOccurrence?.isCurrent()).toBe(false);
        expect(secondOccurrence?.isCurrent()).toBe(true);
        // A superseded occurrence can never supply authority for the live turn.
        expect(firstOccurrence?.readActiveTurnAdmissionWitness()).toBeNull();
        expect(secondOccurrence?.readActiveTurnAdmissionWitness()).toMatchObject({ turnId: 'turn-2' });

        // Disposing the retired occurrence must not retire the live one.
        first.dispose();
        expect(registry.reader.readCurrentRunOccurrence('run-a')?.occurrenceId)
            .toBe(secondOccurrence?.occurrenceId);
        second.dispose();
        expect(registry.reader.readCurrentRunOccurrence('run-a')).toBeNull();
    });

    it('invalidates the witness as soon as the native runtime lifetime ends, before retirement completes', () => {
        const controllers = new Map<string, ExecutionRunController>();
        const controller = { kind: 'backend', controllerOccurrenceId: 'occurrence-a' } as ExecutionRunController;
        controllers.set('run-a', controller);
        const registry = createExecutionRunOccurrenceWitnessRegistry(controllers);
        let runtimeLive = true;
        const registration = registry.register({
            runId: 'run-a',
            sidechainId: 'chain-a',
            runtimeLifetimeSignal: liveRuntimeSignal(),
            controller: controller as Extract<ExecutionRunController, { kind: 'backend' }>,
            isRuntimeLive: () => runtimeLive,
            readActiveTurnAdmissionWitness: () => witnessA,
        });
        const occurrence = registry.reader.readCurrentRunOccurrence('run-a');
        expect(occurrence?.readActiveTurnAdmissionWitness()).toEqual(witnessA);

        // Disposal has started on the native Session but settlement has not yet
        // retired the registration. No later call may still read the witness.
        runtimeLive = false;
        expect(occurrence?.isCurrent()).toBe(false);
        expect(occurrence?.readActiveTurnAdmissionWitness()).toBeNull();
        expect(registry.reader.readCurrentRunOccurrence('run-a')).toBeNull();
        registration.dispose();
    });

    it('keeps two concurrent runs on their own occurrence authority', () => {
        const controllers = new Map<string, ExecutionRunController>();
        const controllerA = { kind: 'backend', controllerOccurrenceId: 'occurrence-a' } as ExecutionRunController;
        const controllerB = { kind: 'backend', controllerOccurrenceId: 'occurrence-b' } as ExecutionRunController;
        controllers.set('run-a', controllerA);
        controllers.set('run-b', controllerB);
        const registry = createExecutionRunOccurrenceWitnessRegistry(controllers);
        registry.register({
            runId: 'run-a',
            sidechainId: 'chain-a',
            runtimeLifetimeSignal: liveRuntimeSignal(),
            controller: controllerA as Extract<ExecutionRunController, { kind: 'backend' }>,
            readActiveTurnAdmissionWitness: () => ({ ...witnessA, turnId: 'turn-a' }),
        });
        registry.register({
            runId: 'run-b',
            sidechainId: 'chain-b',
            runtimeLifetimeSignal: liveRuntimeSignal(),
            controller: controllerB as Extract<ExecutionRunController, { kind: 'backend' }>,
            readActiveTurnAdmissionWitness: () => ({ ...witnessA, turnId: 'turn-b' }),
        });

        expect(registry.reader.readCurrentRunOccurrence('run-a')?.readActiveTurnAdmissionWitness())
            .toMatchObject({ turnId: 'turn-a' });
        expect(registry.reader.readCurrentRunOccurrence('run-b')?.readActiveTurnAdmissionWitness())
            .toMatchObject({ turnId: 'turn-b' });
    });

    it('derives currentness from the canonical controller entry even before retired cleanup runs', () => {
        const controllers = new Map<string, ExecutionRunController>();
        const controller = { kind: 'backend', controllerOccurrenceId: 'occurrence-a' } as ExecutionRunController;
        controllers.set('run-a', controller);
        const registry = createExecutionRunOccurrenceWitnessRegistry(controllers);
        const registration = registry.register({
            runId: 'run-a',
            sidechainId: 'chain-a',
            controller: controller as Extract<ExecutionRunController, { kind: 'backend' }>,
            runtimeLifetimeSignal: liveRuntimeSignal(),
            readActiveTurnAdmissionWitness: () => witnessA,
        });

        controllers.set('run-a', {
            kind: 'backend',
            controllerOccurrenceId: 'occurrence-replacement',
        } as ExecutionRunController);

        expect(registration.occurrence.isCurrent()).toBe(false);
        expect(registry.reader.readCurrentRunOccurrence('run-a')).toBeNull();
    });
});
