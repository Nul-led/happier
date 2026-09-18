import { describe, expect, it } from 'vitest';

import { createWorkflowDefinitionFixture, createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';

import {
    buildWorkflowReviewedRunSeed,
    readWorkflowReviewedRunSeed,
    storeWorkflowReviewedRunSeed,
} from './workflowReviewedRunSeed';

const ACCEPTED_CONTEXT = {
    source: { kind: 'inline' as const },
    inputs: { topic: 'release' },
    machineId: 'machine-1',
    executionTarget: { kind: 'attached_run' as const },
    workspaceTarget: { project: { machineId: 'machine-1', directory: '/Users/me/project' } },
    origin: { kind: 'direct' as const },
};

describe('workflow reviewed-run seed', () => {
    it('carries the accepted definition, placement, runtime and inputs of the run it reviews', () => {
        const definition = createWorkflowDefinitionFixture();
        const seed = buildWorkflowReviewedRunSeed({
            run: createWorkflowRunSummaryFixture({ id: 'run-interrupted', state: 'interrupted' }),
            definition,
            acceptedContext: ACCEPTED_CONTEXT,
            reasonCode: 'workspace_conflict',
        });

        expect(seed).toMatchObject({
            name: 'Analyze the repository',
            project: { machineId: 'machine-1', directory: '/Users/me/project' },
            // Repeating effectful work under a different runtime would be a
            // different operation; the reviewed copy keeps what was accepted.
            executionTarget: { kind: 'attached_run' },
            inputs: { topic: 'release' },
            supersededRunId: 'run-interrupted',
            reasonCode: 'workspace_conflict',
        });
        expect(seed.definition).toEqual(definition);
    });

    it('reads the stored copy exactly once so history cannot re-seed the editor', () => {
        const seed = buildWorkflowReviewedRunSeed({
            run: createWorkflowRunSummaryFixture({ id: 'run-1' }),
            definition: createWorkflowDefinitionFixture(),
            acceptedContext: ACCEPTED_CONTEXT,
            reasonCode: 'workspace_unavailable',
        });
        const seedId = storeWorkflowReviewedRunSeed(seed);

        expect(readWorkflowReviewedRunSeed(seedId)).toEqual(seed);
        expect(readWorkflowReviewedRunSeed(seedId)).toBeNull();
    });

    it('refuses a handle that does not name a reviewed-run copy', () => {
        expect(readWorkflowReviewedRunSeed('not-a-stored-seed')).toBeNull();
    });
});
