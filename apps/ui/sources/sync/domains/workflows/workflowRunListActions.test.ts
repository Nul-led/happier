import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';

const executeMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => executeMock,
}));

describe('workflow Run list Action client', () => {
    beforeEach(() => {
        executeMock.mockReset();
    });

    it('reads a page through the canonical list Action and parses its result', async () => {
        const { listWorkflowRuns } = await import('./workflowRunListActions');
        executeMock.mockResolvedValueOnce({
            ok: true,
            result: { runs: [createWorkflowRunSummaryFixture({ id: 'run-1' })], nextCursor: 'cursor-2' },
        });

        const page = await listWorkflowRuns({ cursor: 'cursor-1', limit: 20 });

        const [actionId, input] = executeMock.mock.calls[0]!;
        expect(actionId).toBe('workflow.run.list');
        expect(input).toEqual({ cursor: 'cursor-1', limit: 20 });
        expect(page.runs[0]?.id).toBe('run-1');
        expect(page.nextCursor).toBe('cursor-2');
    });

    it('materializes unavailable metadata for every Run returned by an older host', async () => {
        const { listWorkflowRuns } = await import('./workflowRunListActions');
        executeMock.mockResolvedValueOnce({
            ok: true,
            result: {
                runs: [
                    createWorkflowRunSummaryFixture({ id: 'run-1' }),
                    createWorkflowRunSummaryFixture({ id: 'run-2' }),
                ],
            },
        });

        const page = await listWorkflowRuns();

        expect(page.metadataByRunId).toEqual({
            'run-1': { kind: 'unavailable' },
            'run-2': { kind: 'unavailable' },
        });
    });

    it('asks the server for attention rather than scanning a cached page', async () => {
        const { buildWorkflowRunListFilter, listWorkflowRuns } = await import('./workflowRunListActions');
        executeMock.mockResolvedValueOnce({ ok: true, result: { runs: [] } });

        await listWorkflowRuns({ filter: buildWorkflowRunListFilter('attention') });

        expect(executeMock.mock.calls[0]![1]).toEqual({ attention: 'required' });
    });

    it('raises the one canonical workflow error with its closed code, not a generic Error', async () => {
        const { listWorkflowRuns } = await import('./workflowRunListActions');
        const { WorkflowActionError } = await import('./workflowActionError');
        executeMock.mockResolvedValueOnce({
            ok: false,
            errorCode: 'run_access_denied',
            error: 'That Account cannot read this run.',
        });

        const failure = await listWorkflowRuns().then(() => null, (error: unknown) => error);

        expect(failure).toBeInstanceOf(WorkflowActionError);
        expect((failure as InstanceType<typeof WorkflowActionError>).code).toBe('run_access_denied');
        expect((failure as Error).message).toBe('That Account cannot read this run.');
    });

    it('keeps an unrecognized transport failure uncoerced instead of inventing a workflow code', async () => {
        const { listWorkflowRuns } = await import('./workflowRunListActions');
        const { WorkflowActionError } = await import('./workflowActionError');
        executeMock.mockResolvedValueOnce({ ok: false, errorCode: 'transport_closed', error: 'Connection lost.' });

        const failure = await listWorkflowRuns().then(() => null, (error: unknown) => error);

        expect(failure).toBeInstanceOf(WorkflowActionError);
        expect((failure as InstanceType<typeof WorkflowActionError>).code).toBeNull();
        expect((failure as InstanceType<typeof WorkflowActionError>).rawCode).toBe('transport_closed');
    });

    it('rejects a malformed list response instead of handing it to a screen', async () => {
        const { listWorkflowRuns } = await import('./workflowRunListActions');
        executeMock.mockResolvedValueOnce({ ok: true, result: { runs: [{ id: 'run-1' }] } });

        await expect(listWorkflowRuns()).rejects.toThrow();
    });

    it('maps the Active filter onto canonical nonterminal states only', async () => {
        const { buildWorkflowRunListFilter } = await import('./workflowRunListActions');
        const active = buildWorkflowRunListFilter('active');
        expect(active.states).toBeDefined();
        expect(active.states).not.toContain('succeeded');
        expect(active.states).not.toContain('cancelled');
        expect(buildWorkflowRunListFilter('all')).toEqual({});
    });
});
