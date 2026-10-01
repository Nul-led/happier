import { describe, expect, it } from 'vitest';
import { AutomationDefinitionListItemSchema, AutomationV3RunListItemSchema } from '@happier-dev/protocol';

import { createAutomationDefinitionSummary } from '@/sync/domains/automations/automationDefinitionProjection';
import type { AutomationDefinition, AutomationDefinitionRun } from '@/sync/domains/automations/automationTypes';

import {
    automationRunTone,
    projectLatestAutomationRuns,
    selectLatestRunAutomationIds,
} from './latestAutomationRuns';

function automation(id: string, lastRunAt: number | null, name = id): AutomationDefinition {
    return createAutomationDefinitionSummary(AutomationDefinitionListItemSchema.parse({
        id,
        name,
        description: null,
        enabled: true,
        triggers: [],
        targetType: 'newSession',
        existingSessionId: null,
        templateVersion: 1,
        lastRunAt,
        createdAt: 1,
        updatedAt: 1,
        assignments: [],
    }));
}

function run(id: string, automationId: string, at: number, state: AutomationDefinitionRun['state'] = 'succeeded'): AutomationDefinitionRun {
    return AutomationV3RunListItemSchema.parse({
        id,
        automationId,
        revision: 1,
        triggerId: null,
        triggerRetired: false,
        state,
        cause: { kind: 'manual', invokedAt: at },
        dueAt: at,
        claimedAt: null,
        startedAt: null,
        finishedAt: null,
        claimedByMachineId: null,
        leaseExpiresAt: null,
        attempt: 0,
        errorCode: null,
        producedSessionId: null,
        executionDispatchState: null,
        executionAttempt: 0,
        replyHandoffState: 'none',
        replyHandoffAttempt: 0,
        replyHandoffDueAt: null,
        createdAt: at,
        updatedAt: at,
    });
}

describe('latest Automation runs', () => {
    it('reads the Automations that settled a Run most recently, never ones that have not run', () => {
        const ids = selectLatestRunAutomationIds([
            automation('never', null),
            automation('old', 100),
            automation('newest', 900),
            automation('middle', 500),
        ], 2);
        expect(ids).toEqual(['newest', 'middle']);
    });

    it('interleaves Runs of several Automations newest first, repeating an Automation when it ran twice', () => {
        const automations = [automation('triage', 900, 'Morning triage'), automation('deps', 800, 'Nightly deps')];
        const rows = projectLatestAutomationRuns({
            automations,
            runs: [
                run('t-today', 'triage', 900),
                run('t-yesterday', 'triage', 100),
                run('d-now', 'deps', 950, 'running'),
                run('d-old', 'deps', 50, 'failed'),
            ],
            count: 3,
        });
        expect(rows.map((row) => [row.run.id, row.automationName, row.tone])).toEqual([
            ['d-now', 'Nightly deps', 'active'],
            ['t-today', 'Morning triage', 'succeeded'],
            ['t-yesterday', 'Morning triage', 'succeeded'],
        ]);
    });

    it('drops a Run whose Automation is no longer in the Account', () => {
        const rows = projectLatestAutomationRuns({
            automations: [automation('kept', 10)],
            runs: [run('gone-run', 'deleted', 999), run('kept-run', 'kept', 10)],
            count: 4,
        });
        expect(rows.map((row) => row.run.id)).toEqual(['kept-run']);
    });

    it('reads every state the Protocol publishes as one of the glance tones', () => {
        expect(automationRunTone('queued')).toBe('active');
        expect(automationRunTone('dispatch_failed')).toBe('failed');
        expect(automationRunTone('outcome_uncertain')).toBe('uncertain');
        expect(automationRunTone('skipped')).toBe('neutral');
    });
});
