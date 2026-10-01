import { afterEach, expect, it, vi } from 'vitest';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { createWorkflowRunAccountStorage } from './apiWorkflowRunStorage';

// Public capability discovery and captured HTTP are network boundaries.
const runtimeFetch = vi.hoisted(() => vi.fn());
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: (...args: unknown[]) => runtimeFetch(...args) }));
afterEach(() => { runtimeFetch.mockReset(); vi.restoreAllMocks(); });

it('rejects worker publication and unknown operations before any Account request', async () => {
    const request = vi.fn();
    const storage = createWorkflowRunAccountStorage({ credentials: { token: 'token' }, serverId: 'captured-home', request, assertCurrent: () => {} });
    for (const operation of ['admit', 'invocations.recover', 'invocations.fact', 'transition', 'unknown']) {
        await expect(storage.execute({ operation })).rejects.toMatchObject({ code: 'run_access_denied' });
    }
    await expect(storage.execute({ operation: 'get', publisherMachineId: 'machine' })).rejects.toMatchObject({ code: 'run_access_denied' });
    await expect(storage.execute({ operation: 'get' }, { publisherMachineId: 'machine' })).rejects.toMatchObject({ code: 'run_access_denied' });
    expect(request).not.toHaveBeenCalled();
    expect(runtimeFetch).not.toHaveBeenCalled();
});

it('uses captured ordinary credentials and propagates canonical transport errors', async () => {
    const home = await upsertAndActivateServer({ serverUrl: 'https://workflow-storage-api.test', scope: 'tab' });
    runtimeFetch.mockRejectedValue(new Error('unexpected_capability_probe'));
    const request = vi.fn(async () => new Response(JSON.stringify({ error: 'run_not_found' }), { status: 404 }));
    const storage = createWorkflowRunAccountStorage({ credentials: { token: 'captured-token' }, serverId: home.id, request, assertCurrent: () => {} });
    await expect(storage.execute({ operation: 'get', runId: 'run-id' })).rejects.toMatchObject({ code: 'run_not_found', status: 404 });
    expect(request).toHaveBeenCalledWith('/v3/automations/runs/workflow-storage', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ operation: 'get', runId: 'run-id' }),
        headers: { Authorization: 'Bearer captured-token', 'Content-Type': 'application/json' },
    }), { includeAuth: false });
    expect(runtimeFetch).not.toHaveBeenCalled();
});
