import { describe, expect, it } from 'vitest';
import { ExternalActionTargetV1Schema } from '@happier-dev/protocol';

import { projectAcceptedWorkflowRunTarget } from './projectAcceptedWorkflowRunTarget';

describe('projectAcceptedWorkflowRunTarget', () => {
    it('projects only the original signed project target fields for a reviewed new whole Run', () => {
        const project = projectAcceptedWorkflowRunTarget({
            machineId: 'machine-1',
            directory: '/repo/packages/app',
            workspaceRefId: 'workspace-1',
        });

        expect(project).toEqual({
            machineId: 'machine-1',
            directory: '/repo/packages/app',
            workspaceRefId: 'workspace-1',
        });
        expect(ExternalActionTargetV1Schema.safeParse({
            kind: 'machine', machineId: project.machineId, project,
        }).success).toBe(true);
    });
});
