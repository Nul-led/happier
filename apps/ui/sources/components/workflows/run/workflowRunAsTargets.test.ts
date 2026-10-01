import { describe, expect, it } from 'vitest';

import {
    isWorkflowRunAsTargetAvailable,
    resolveAdmittedWorkflowExecutionTarget,
    resolveWorkflowRunAsTargets,
} from './workflowRunAsTargets';

/**
 * `Run as` availability is a projection of the canonical Execution Run
 * capability owner plus the current Workflows feature decision. It is not a
 * standing policy constant, and it is not a Workflow-specific capability bit.
 */
describe('workflow Run as targets', () => {
    it('offers the detached runtime once the canonical capability owner reports support', () => {
        const targets = resolveWorkflowRunAsTargets({ detachedExecutionRun: 'supported' });
        expect(targets.map((target) => target.kind)).toEqual(['session', 'detached_run']);
        expect(targets.find((target) => target.kind === 'detached_run')).toEqual({
            kind: 'detached_run',
            available: true,
        });
        expect(isWorkflowRunAsTargetAvailable(targets, 'detached_run')).toBe(true);
    });

    it('states why an unsupported or unprobed runtime cannot be chosen rather than hiding it', () => {
        const unsupported = resolveWorkflowRunAsTargets({ detachedExecutionRun: 'unsupported' });
        expect(unsupported.find((target) => target.kind === 'detached_run')).toEqual({
            kind: 'detached_run',
            available: false,
            unavailableReason: 'machine_does_not_support_detached_runs',
        });

        const unknown = resolveWorkflowRunAsTargets({ detachedExecutionRun: 'unknown' });
        expect(unknown.find((target) => target.kind === 'detached_run')).toEqual({
            kind: 'detached_run',
            available: false,
            unavailableReason: 'capability_unknown',
        });

        const noMachine = resolveWorkflowRunAsTargets({ detachedExecutionRun: 'machine_not_selected' });
        expect(noMachine.find((target) => target.kind === 'detached_run')).toEqual({
            kind: 'detached_run',
            available: false,
            unavailableReason: 'machine_not_selected',
        });
    });

    it('never reports Session execution as blocked by the detached probe', () => {
        for (const detachedExecutionRun of ['supported', 'unsupported', 'unknown', 'machine_not_selected'] as const) {
            const targets = resolveWorkflowRunAsTargets({ detachedExecutionRun });
            expect(isWorkflowRunAsTargetAvailable(targets, 'session')).toBe(true);
        }
    });

    it('refuses an unavailable selection instead of quietly running it as a Session', () => {
        const targets = resolveWorkflowRunAsTargets({ detachedExecutionRun: 'unsupported' });
        // The plausible wrong implementation falls back to the protocol default,
        // which would repeat effectful work under different execution semantics.
        expect(resolveAdmittedWorkflowExecutionTarget({ selected: 'detached_run', targets })).toBeNull();
        expect(resolveAdmittedWorkflowExecutionTarget({ selected: 'session', targets }))
            .toEqual({ kind: 'session' });
    });

    it('admits the detached runtime exactly when the canonical owner says it is available', () => {
        const targets = resolveWorkflowRunAsTargets({ detachedExecutionRun: 'supported' });
        expect(resolveAdmittedWorkflowExecutionTarget({ selected: 'detached_run', targets }))
            .toEqual({ kind: 'detached_run' });
    });
});
