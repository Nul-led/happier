import { describe, expect, it, vi } from 'vitest';

import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { createFrontDoorActionExecute } from './frontDoorRuntimeActionExecutor';
import { createUiWorkflowAction } from './workflowActionDeps';

const scope = { serverId: 'server-a', accountId: 'account-a' } as const;

function createHarness() {
    let current = true;
    const transport = vi.fn(async ({ method }: { method: string }) => method === 'workflow.definition.list'
        ? { definitions: [] }
        : {
            run: createWorkflowRunSummaryFixture({
                id: '00000000-0000-4000-8000-000000000001',
                availability: { restoreWorkspace: false },
            }),
            admission: 'created' as const,
        });
    const workflowAction = createUiWorkflowAction({
        account: {
            ...scope,
            assertCurrent: () => {
                if (!current) throw Object.assign(new Error('action_account_scope_changed'), { code: 'action_account_scope_changed' });
            },
        },
        transport,
    });
    // This fixture supplies the one port under test; the production default
    // executor supplies the remaining host ports.
    const deps = {
        workflowAction,
        isActionEnabled: () => true,
        isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps;
    const execute = createFrontDoorActionExecute(createActionExecutor(deps));
    const context = {
        surface: 'ui' as const,
        ...scope,
        runtimeAccountId: scope.accountId,
        externalActionTarget: {
            kind: 'machine' as const,
            machineId: 'machine-a',
            project: { machineId: 'machine-a', directory: '/repo' },
        },
    };
    return { execute, context, transport, retire: () => { current = false; } };
}

describe('UI Workflow Action front door', () => {
    it('routes definition reads and Run starts through the installed daemon Action port with exact scope', async () => {
        const harness = createHarness();
        await expect(harness.execute('workflow.definition.list', {}, harness.context)).resolves.toEqual({
            ok: true,
            result: { definitions: [] },
        });
        const startResult = await harness.execute('workflow.run.start', {
            runId: '00000000-0000-4000-8000-000000000001',
            source: { kind: 'inline', definition: { blocks: ['Do the thing'] } },
        }, harness.context);
        expect(startResult).toMatchObject({ ok: true, result: { admission: 'created' } });
        expect(harness.transport.mock.calls.map(([call]) => call)).toEqual([
            expect.objectContaining({ serverId: 'server-a', accountId: 'account-a', machineId: 'machine-a', method: 'workflow.definition.list' }),
            expect.objectContaining({ serverId: 'server-a', accountId: 'account-a', machineId: 'machine-a', method: 'workflow.run.start' }),
        ]);
    });

    it('fails closed for another Home and for a retired Account lifetime', async () => {
        const harness = createHarness();
        await expect(harness.execute('workflow.definition.list', {}, {
            ...harness.context,
            serverId: 'server-b',
        })).resolves.toMatchObject({ ok: false, errorCode: 'content_unavailable' });
        expect(harness.transport).not.toHaveBeenCalled();

        harness.retire();
        await expect(harness.execute('workflow.definition.list', {}, harness.context))
            .resolves.toMatchObject({ ok: false, errorCode: 'content_unavailable' });
        expect(harness.transport).not.toHaveBeenCalled();
    });
});
import { createActionExecutor, type ActionExecutorDeps } from '@happier-dev/protocol';
