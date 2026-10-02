import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowTriggerSetV1Schema } from '@happier-dev/protocol';
import { createDeferred, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { useWorkflowTriggerEditing } from './useWorkflowTriggerEditing';
import { editWorkflowTriggerDraft } from './workflowTriggerDraft';

// The Action transport and applied network identity are boundaries; schemas, store and hook stay real.
const transport = vi.hoisted(() => vi.fn());
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({ createFrontDoorActionExecute: () => transport }));
vi.mock('@/sync/runtime/orchestration/connectionManager', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/connectionManager')>(),
    getAppliedActiveServerSnapshot: () => ({ serverId: storage.getState().profileScope?.serverId }),
    isAppliedActiveServerRuntimeAvailable: () => true,
}));

const definitionId = '00000000-0000-4000-8000-000000000001';
const projectTarget = { machineId: 'm1', directory: '/repo' };
const trigger = { kind: 'schedule', enabled: true, schedule: { kind: 'cron', scheduleExpr: '0 9 * * *', everyMs: null, timezone: null } } as const;
const set = WorkflowTriggerSetV1Schema.parse({ automationId: 'set-1', revision: 1, enabled: true, health: 'available', project: projectTarget,
    target: { kind: 'workflow', ref: definitionId }, triggers: [{ ...trigger, id: 't1', revision: 1, createdAt: 1, updatedAt: 1 }] });
let previous = storage.getState();
beforeEach(() => {
    previous = storage.getState();
    storage.setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' } });
    transport.mockReset();
    transport.mockResolvedValue({ ok: true, result: { sets: [] } });
});
afterEach(() => { standardCleanup(); storage.setState(previous); });

describe('workflow trigger editing lifetime', () => {
    it('resets pending edits across source, Account and server changes, including unsaved sources', async () => {
        const hook = await renderHook(useWorkflowTriggerEditing, { initialProps: { definitionId: null, sourceKey: 'new-a', projectTarget } });
        const add = async () => act(async () => hook.getCurrent().setDraft(editWorkflowTriggerDraft(hook.getCurrent().draft, { kind: 'add', clientId: 'c1', trigger })));
        await add();
        expect(hook.getCurrent().dirty).toBe(true);
        await hook.rerender({ definitionId: null, sourceKey: 'new-b', projectTarget });
        expect(hook.getCurrent().dirty).toBe(false);
        await add();
        await act(async () => storage.setState({ profileScope: { serverId: 'server-a', accountId: 'account-b' } }));
        expect(hook.getCurrent().dirty).toBe(false);
        await add();
        await act(async () => storage.setState({ profileScope: { serverId: 'server-b', accountId: 'account-b' } }));
        expect(hook.getCurrent().dirty).toBe(false);
    });

    it('subtracts acknowledged additions while keeping edits made during Save', async () => {
        const deferred = createDeferred<unknown>();
        transport.mockImplementation(async (action: string) => action === 'workflow.trigger.add' ? deferred.promise : { ok: true, result: { sets: [] } });
        const hook = await renderHook(useWorkflowTriggerEditing, { initialProps: { definitionId, sourceKey: 'saved-a', projectTarget } });
        await act(async () => hook.getCurrent().setDraft(editWorkflowTriggerDraft(hook.getCurrent().draft, { kind: 'add', clientId: 'captured', trigger })));
        let saving!: ReturnType<ReturnType<typeof hook.getCurrent>['save']>;
        await act(async () => { saving = hook.getCurrent().save(definitionId, () => true); });
        await act(async () => hook.getCurrent().setDraft(editWorkflowTriggerDraft(hook.getCurrent().draft, { kind: 'add', clientId: 'later', trigger })));
        await act(async () => { deferred.resolve({ ok: true, result: { set, triggerId: 't1', triggerRevision: 1 } }); await saving; });
        expect(hook.getCurrent().draft.adds.map((add) => add.clientId)).toEqual(['later']);
    });

    it('reports failed reads, keeps known rows and retries the same owner', async () => {
        transport.mockResolvedValueOnce({ ok: true, result: { sets: [set] } });
        const hook = await renderHook(useWorkflowTriggerEditing, { initialProps: { definitionId, sourceKey: 'saved-a', projectTarget } });
        expect(hook.getCurrent().set?.automationId).toBe('set-1');
        transport.mockRejectedValueOnce(new Error('offline'));
        await act(async () => hook.getCurrent().retry());
        expect(hook.getCurrent().status).toBe('failed');
        expect(hook.getCurrent().set?.automationId).toBe('set-1');
        transport.mockResolvedValueOnce({ ok: true, result: { sets: [set] } });
        await act(async () => hook.getCurrent().retry());
        expect(hook.getCurrent().status).toBe('ready');
    });
});
