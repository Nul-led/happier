import { describe, expect, it, vi } from 'vitest';

import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { WorkflowActionError } from '@/sync/domains/workflows/workflowActionError';

import { materializeWorkflowRunAccountChange } from './materializeWorkflowRunAccountChange';

describe('materializeWorkflowRunAccountChange', () => {
    it('upserts the exact authoritative Run body', async () => {
        const summary = createWorkflowRunSummaryFixture({ id: 'run-1' });
        const upsertRun = vi.fn();
        const removeRun = vi.fn();

        await materializeWorkflowRunAccountChange({
            runId: 'run-1',
            getRun: async () => ({ run: summary, metadata: null }),
            upsertRun,
            removeRun,
        });

        expect(upsertRun).toHaveBeenCalledWith({ run: summary, metadata: null });
        expect(removeRun).not.toHaveBeenCalled();
    });

    it('treats an authoritative run_not_found as deletion', async () => {
        const upsertRun = vi.fn();
        const removeRun = vi.fn();

        await materializeWorkflowRunAccountChange({
            runId: 'run-1',
            getRun: async () => {
                throw new WorkflowActionError({ message: 'Missing', rawCode: 'run_not_found' });
            },
            upsertRun,
            removeRun,
        });

        expect(removeRun).toHaveBeenCalledWith('run-1');
        expect(upsertRun).not.toHaveBeenCalled();
    });

    it('rejects non-authoritative failures so the Account-change cursor is held', async () => {
        await expect(materializeWorkflowRunAccountChange({
            runId: 'run-1',
            getRun: async () => {
                throw new WorkflowActionError({ message: 'Offline', rawCode: 'transport_closed' });
            },
            upsertRun: vi.fn(),
            removeRun: vi.fn(),
        })).rejects.toThrow('Offline');
    });
});
