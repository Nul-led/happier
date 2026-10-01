import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createHomeGovernanceHarness, installHomeGovernanceBoundaries } from '@/dev/testkit/harness/homeGovernanceHarness';

const rpc = vi.hoisted(() => ({ machine: vi.fn() }));
// The remote daemon transport is the boundary; registry adaptation, inventory
// selection, Action admission and daemon-fact projection execute unchanged.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: rpc.machine,
}));
const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);
// These imports must follow the harness's doMock boundary installation. Load
// once during collection so cold transforms do not consume each hook's budget.
const { clearDaemonMergedProjectionCacheForTests } = await import('@/agents/backendCatalog/loadDaemonMergedProjectionInputs');
const { createDefaultActionExecutor } = await import('./defaultActionExecutor');

const facts = {
    installed: false, version: null, latestVersion: null,
    update: { supported: false, command: null },
    signIn: { status: 'unknown', loginSupport: 'manual_only' },
    platform: { supported: false, reason: 'arch' },
    install: { available: false, mode: 'none', sizeBytes: null, guideUrl: null },
    dependencies: [{ key: 'remote-adapter', installed: true, version: '1.0' }],
} as const;

describe('UI machine Agent inventory Action transport', () => {
    beforeEach(async () => {
        await harness.reset();
        rpc.machine.mockReset();
        clearDaemonMergedProjectionCacheForTests();
    });
    afterEach(() => standardCleanup());

    it('uses the target daemon roster and returns daemon facts on the exact Home and machine', async () => {
        const serverId = await harness.addHome({ name: 'Inventory Home', serverUrl: 'https://inventory.test', accountId: 'alice' });
        rpc.machine.mockImplementation(async (request: { method: string }) => {
            if (request.method === RPC_METHODS.DAEMON_MERGED_CONTRIBUTION_REGISTRY_PROJECTION_DESCRIBE) {
                return { protocolVersion: 1, projection: { v: 2, generation: 1, familiesById: {}, agentsById: {
                    'acme/helper': { id: 'helper', title: 'Remote Helper', capabilities: { sessions: { open: ['create'], delivery: ['newTurn'], cancel: true } } },
                    'acme/viewer': { id: 'viewer', title: 'Viewer', capabilities: { surfaces: [] } },
                } } };
            }
            return { protocolVersion: 1, results: {
                'cli.acme/helper': { ok: true, checkedAt: 1, data: { ...facts, available: true, resolvedPath: '/private/path' } },
            } };
        });
        const result = await createDefaultActionExecutor().execute('machines.agents.list', {
            machineId: 'machine-1', serverId, refresh: true,
        }, { surface: 'ui', authority: 'present_user', serverId });
        expect(result).toEqual({ ok: true, result: { items: [{ agentId: 'acme/helper', title: 'Remote Helper', ...facts }] } });
        expect(rpc.machine.mock.calls.map(([request]) => request)).toEqual([
            expect.objectContaining({ machineId: 'machine-1', serverId, method: RPC_METHODS.DAEMON_MERGED_CONTRIBUTION_REGISTRY_PROJECTION_DESCRIBE }),
            expect.objectContaining({ machineId: 'machine-1', serverId, method: RPC_METHODS.CAPABILITIES_DETECT,
                payload: { requests: [{ id: 'cli.acme/helper', params: { includeLoginStatus: true, includeLatestVersion: true } }], bypassCache: true },
            }),
        ]);
    });

    it.each(['install', 'update'] as const)('starts a %s job on the captured Home with explicit vendor consent', async (intent) => {
        const serverId = await harness.addHome({ name: 'Setup Home', serverUrl: 'https://setup.test', accountId: 'alice' });
        const signal = new AbortController().signal;
        rpc.machine.mockResolvedValueOnce({ ok: true, jobId: 'job-1' });
        const result = await createDefaultActionExecutor().execute('machines.agents.install', {
            machineId: 'machine-1', agentId: 'acme/helper', intent,
            ...(intent === 'update' ? { consent: { vendorRecipe: true }, force: true } : {}),
        }, { surface: 'ui', authority: 'present_user', serverId, signal });
        expect(result).toEqual({ ok: true, result: { ok: true, jobId: 'job-1' } });
        expect(rpc.machine).toHaveBeenLastCalledWith({
            machineId: 'machine-1', serverId, signal, method: RPC_METHODS.DAEMON_AGENTS_INSTALL_START,
            payload: { agentId: 'acme/helper', intent, consent: { vendorRecipe: intent === 'update' },
                ...(intent === 'update' ? { force: true } : {}),
            },
        });
    });

    it('preserves current job progress at a consumed cursor and exposes cancellation failure', async () => {
        const serverId = await harness.addHome({ name: 'Setup Home', serverUrl: 'https://setup.test', accountId: 'alice' });
        const signal = new AbortController().signal;
        const progress = [{ stepId: 'cli', bytesDone: 128, bytesTotal: 256 }];
        const snapshot = { ok: true, steps: [{ stepId: 'cli', label: 'Install CLI', state: 'running' }],
            progress, events: [], nextCursor: 4, done: false, outcome: null };
        rpc.machine.mockResolvedValueOnce(snapshot)
            .mockResolvedValueOnce({ ok: false, errorCode: 'job_not_found', error: 'No job' });
        const executor = createDefaultActionExecutor();
        const context = { surface: 'ui' as const, authority: 'present_user' as const, serverId, signal };
        expect(await executor.execute('machines.agents.install.status', {
            machineId: 'machine-1', jobId: 'job-1', cursor: 4,
        }, context)).toEqual({ ok: true, result: snapshot });
        expect(await executor.execute('machines.agents.install.cancel', {
            machineId: 'machine-1', jobId: 'job-1',
        }, context)).toMatchObject({ ok: false, errorCode: 'job_not_found' });
        expect(rpc.machine.mock.calls.map(([request]) => request)).toEqual([
            { machineId: 'machine-1', serverId, signal, method: RPC_METHODS.DAEMON_AGENTS_INSTALL_READ,
                payload: { jobId: 'job-1', cursor: 4 } },
            { machineId: 'machine-1', serverId, signal, method: RPC_METHODS.DAEMON_AGENTS_INSTALL_CANCEL,
                payload: { jobId: 'job-1' } },
        ]);
    });

    it('launches native sign-in through the terminal owner and reads the daemon status', async () => {
        const serverId = await harness.addHome({ name: 'Sign-in Home', serverUrl: 'https://signin.test', accountId: 'alice' });
        const signal = new AbortController().signal;
        const status = { status: 'signedIn', accountLabel: 'alice@example.invalid', checkedAt: 5,
            nativeLogin: 'login_terminal', connectedServices: [] };
        rpc.machine.mockResolvedValueOnce({ method: 'native', launch: { kind: 'agent_login', agentId: 'acme/helper' } })
            .mockResolvedValueOnce({ ok: true, terminalId: 'login-terminal', reused: false })
            .mockResolvedValueOnce(status);
        const executor = createDefaultActionExecutor();
        const context = { surface: 'ui' as const, authority: 'present_user' as const, serverId, signal };
        expect(await executor.execute('machines.agents.signIn.start', {
            machineId: 'machine-1', agentId: 'acme/helper', method: 'native',
        }, context)).toEqual({ ok: true, result: { terminalKey: 'provider-login:machine-1:acme/helper' } });
        expect(await executor.execute('machines.agents.signIn.status', {
            machineId: 'machine-1', agentId: 'acme/helper',
        }, context)).toEqual({ ok: true, result: status });
        expect(rpc.machine.mock.calls.map(([request]) => request)).toEqual([
            { machineId: 'machine-1', serverId, signal, method: 'daemon.agents.signIn.prepare',
                payload: { agentId: 'acme/helper', method: 'native' } },
            { machineId: 'machine-1', serverId, timeoutMs: undefined, method: 'daemon.terminal.ensure',
                payload: { terminalKey: 'provider-login:machine-1:acme/helper', launch: { kind: 'agent_login', agentId: 'acme/helper' } } },
            { machineId: 'machine-1', serverId, signal, method: 'daemon.agents.signIn.status',
                payload: { agentId: 'acme/helper' } },
        ]);
    });

    it('starts connected sign-in through the Connected Account owner and retains its typed unavailable result', async () => {
        const serverId = await harness.addHome({ name: 'Sign-in Home', serverUrl: 'https://signin.test', accountId: 'alice' });
        const signal = new AbortController().signal;
        const command = { operation: 'beginConnect', service: { pluginId: 'happier.agent.gemini', localId: 'gemini-account' }, modeId: 'api-key' };
        const unavailable = { status: 'unavailable', code: 'connected_account_daemon_runtime_unavailable' };
        rpc.machine.mockResolvedValueOnce({ method: 'connected', command }).mockResolvedValueOnce(unavailable);
        expect(await createDefaultActionExecutor().execute('machines.agents.signIn.start', {
            machineId: 'machine-1', agentId: 'gemini', method: 'connected', serviceId: 'gemini-account',
        }, { surface: 'ui', authority: 'present_user', serverId, signal })).toEqual({ ok: true, result: unavailable });
        expect(rpc.machine.mock.calls.map(([request]) => request)).toEqual([
            { machineId: 'machine-1', serverId, signal, method: 'daemon.agents.signIn.prepare',
                payload: { agentId: 'gemini', method: 'connected', serviceId: 'gemini-account' } },
            { machineId: 'machine-1', serverId, signal, method: 'daemon.connectedAccounts.authentication.command',
                payload: { v: 1, machineId: 'machine-1', command } },
        ]);
    });
});
