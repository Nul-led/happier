import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

// The machine RPC is the boundary: `tool.systemTasks` start returns a task id, the terminal
// result arrives through `poll` (packages/cli-common interactiveTaskKinds).
const rpc = vi.hoisted(() => ({
    pollResults: [] as unknown[],
    invoke: vi.fn(),
    detect: vi.fn(async (..._args: unknown[]) => ({ supported: true, response: { protocolVersion: 1, results: {} } })),
    jobs: [] as import('@happier-dev/protocol').AgentInstallJob[],
    jobOutcome: { kind: 'succeeded', version: '2.1.283' } as import('@happier-dev/protocol').AgentInstallJobOutcome,
    machineRpc: vi.fn(),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async () => {
    const { createServerScopedMachineRpcBoundaryMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return createServerScopedMachineRpcBoundaryMock(rpc.machineRpc);
});

vi.mock('@/sync/ops', () => ({
    machineCapabilitiesInvoke: (...args: unknown[]) => rpc.invoke(...args),
    // The capability cache owner's detect RPC: the facts re-read after an update.
    machineCapabilitiesDetect: (...args: unknown[]) => rpc.detect(...args),
}));

import type { UpdateItem } from './items/updateItem';

const runs = await import('./machineUpdateRuns');
let testSequence = 0;
let serverA = '';

const remoteCli: UpdateItem = {
    id: 'studio:happier-cli',
    subject: { kind: 'happier-cli' },
    machineId: 'studio',
    title: 'Happier CLI',
    currentVersion: '0.2.12',
    latestVersion: '0.2.14',
    state: 'available',
    progressPercent: null,
    step: null,
    managedBy: 'happier',
    action: { kind: 'run', verb: 'update' },
    failure: null,
    skipped: false,
};

function installRpc() {
    rpc.invoke.mockImplementation(async (_machineId: string, request: { method: string }) => {
        if (request.method === 'start') return { supported: true, response: { ok: true, result: { taskId: 'task-1' } } };
        const next = rpc.pollResults.length > 1 ? rpc.pollResults.shift() : rpc.pollResults[0];
        return { supported: true, response: { ok: true, result: { events: [], nextCursor: 0, result: next ?? null, pendingPrompt: null } } };
    });
}

async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
}

describe('runMachineItemUpdate — a remote CLI update is started, then observed', () => {
    beforeEach(() => {
        serverA = `server-a-${++testSequence}`;
        vi.useFakeTimers();
        rpc.invoke.mockReset();
        rpc.pollResults = [];
        rpc.jobs = [];
        rpc.jobOutcome = { kind: 'succeeded', version: '2.1.283' };
        rpc.machineRpc.mockReset().mockImplementation(async (request: { machineId: string; serverId: string; method: string; payload: { agentId?: string; intent?: 'install' | 'update'; jobId?: string } }) => {
            if (request.method === 'daemon.agents.install.start') {
                const jobId = `job-${request.payload.agentId}`;
                rpc.jobs.push({ jobId, agentId: request.payload.agentId!, intent: request.payload.intent!, startedAt: 1, steps: [], progress: [], done: false, outcome: null });
                return { ok: true, jobId };
            }
            if (request.method === 'daemon.agents.install.list') return { ok: true, jobs: rpc.jobs };
            if (request.method === 'daemon.agents.install.read') return { ok: true, steps: [], progress: [], events: [], nextCursor: 0, done: true, outcome: rpc.jobOutcome };
            const response = await rpc.invoke(request.machineId, request.payload, { serverId: request.serverId });
            return response.supported ? response.response : { error: 'machine unavailable' };
        });
        installRpc();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('an asynchronous refusal shows its failure and never "waiting to reconnect"', async () => {
        rpc.pollResults = [
            null,
            { protocolVersion: 1, taskId: 'task-1', ok: false, error: { code: 'cli_remote_update_unsupported', message: 'no' } },
        ];
        const seenSteps: string[] = [];
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), remoteCli.id, { lastUpdateSignature: '' });

        const done = runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        await advance(0);
        seenSteps.push(String(read().step));
        await advance(5_000);
        await done;
        seenSteps.push(String(read().step));

        expect(read()).toMatchObject({ running: false, errorMessage: 'updates.row.remoteUnsupported' });
        expect(seenSteps).not.toContain('reconnecting');
    });

    it('enters "waiting to reconnect" only once the task reports that it started the updater', async () => {
        rpc.pollResults = [
            null,
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), remoteCli.id, { lastUpdateSignature: '' });

        const done = runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        await advance(0);
        expect(read()).toMatchObject({ running: true, step: 'installing' });
        await advance(5_000);
        await done;
        expect(read()).toMatchObject({ running: true, step: 'reconnecting' });
    });

    it('another update holding the lock is a retryable refusal, never "installing" (its lock may not be this update)', async () => {
        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: false, error: { code: 'cli_update_in_progress', message: 'busy' } },
        ];
        vi.useRealTimers();
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), remoteCli.id, { lastUpdateSignature: '' });
        const done = runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        await done;
        expect(read()).toMatchObject({ running: false, errorMessage: 'updates.row.anotherUpdateRunning' });

        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        await runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        expect(rpc.invoke.mock.calls.filter((call) => call[1]?.method === 'start')).toHaveLength(2);
        expect(read()).toMatchObject({ running: true, step: 'reconnecting', errorMessage: null });
    });

    it('losing the machine before the task confirmed admission is "outcome unknown" (Retry), never admitted', async () => {
        rpc.invoke.mockImplementation(async (_machineId: string, request: { method: string }) => (
            request.method === 'start'
                ? { supported: true, response: { ok: true, result: { taskId: 'task-1' } } }
                : { supported: false, reason: 'error' }
        ));
        vi.useRealTimers();
        const seen: string[] = [];
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), remoteCli.id, { lastUpdateSignature: '' });
        const done = runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        await done;
        seen.push(String(read().step));
        expect(read()).toMatchObject({ running: false, errorMessage: 'updates.row.outcomeUnknown' });
        expect(seen).not.toContain('reconnecting');
        expect(runs.readUnseenUpdateCompletions({ serverId: serverA, accountId: 'account-a' }).size).toBe(0);

        installRpc();
        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        await runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        expect(read()).toMatchObject({ running: true, step: 'reconnecting', errorMessage: null });
        expect(runs.readUnseenUpdateCompletions({ serverId: serverA, accountId: 'account-a' }).get(remoteCli.id)).toBe('pendingRemote');
    });

    it('a machine\'s unseen "Updated" belongs to its server: opening Updates on another server keeps it', async () => {
        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        const done = runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        await advance(5_000);
        await done;
        runs.markUpdateCompletionsSeen({ serverId: 'server-b', accountId: 'account-a' });
        expect(runs.readUnseenUpdateCompletions({ serverId: serverA, accountId: 'account-a' }).get(remoteCli.id)).toBe('pendingRemote');
        expect(runs.readUnseenUpdateCompletions({ serverId: 'server-b', accountId: 'account-a' }).size).toBe(0);
        runs.markUpdateCompletionsSeen({ serverId: serverA, accountId: 'account-a' });
        expect(runs.readUnseenUpdateCompletions({ serverId: serverA, accountId: 'account-a' }).size).toBe(0);
    });

    it('raw installer output never becomes the row\'s sentence; typed failures are localized', async () => {
        rpc.invoke.mockImplementation(async () => ({
            supported: true,
            response: { ok: false, error: { message: 'npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/x', code: 'install-failed' }, logPath: '/logs/codex.log' },
        }));
        rpc.jobOutcome = { kind: 'failed', code: 'install_failed', stepId: 'cli', message: 'npm ERR! code E404\nnpm ERR! 404 Not Found' };
        const codex: UpdateItem = { ...remoteCli, id: 'studio:agent:codex', subject: { kind: 'agent-cli', agentId: 'codex' }, title: 'Codex' };
        await runs.runMachineItemUpdate(codex, { scope: { serverId: serverA, accountId: 'account-a' } });
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), codex.id)).toMatchObject({
            running: false,
            errorMessage: 'agentInstallJob.failedBody',
        });
    });

    it('an in-flight update stays attached to the server it started on, even after switching servers', async () => {
        rpc.pollResults = [
            null,
            null,
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        const done = runs.runMachineItemUpdate(remoteCli, { scope: { serverId: serverA, accountId: 'account-a' }, lastUpdateSignature: '' });
        await advance(5_000);
        await done;

        // Start and every poll go to the original server, never to whichever server is active now.
        expect(rpc.invoke.mock.calls.length).toBeGreaterThanOrEqual(3);
        for (const call of rpc.invoke.mock.calls) expect(call[2]).toMatchObject({ serverId: serverA });
        // The run belongs to that server's rows only.
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), remoteCli.id, { lastUpdateSignature: '' }).running).toBe(true);
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-b'), remoteCli.id, { lastUpdateSignature: '' }).running).toBe(false);
    });

    it('an explicit press runs the vendor updater without asking again, and shows the runtime\'s own reason', async () => {
        rpc.invoke.mockImplementation(async () => ({
            supported: true,
            response: { ok: false, error: { message: 'npm won’t install a release less than a day old.', code: 'update-not-verified' } },
        }));
        rpc.jobOutcome = { kind: 'failed', code: 'verification_failed', stepId: 'cli', message: 'npm won’t install a release less than a day old.' };
        const codex: UpdateItem = { ...remoteCli, id: 'studio:agent:codex', subject: { kind: 'agent-cli', agentId: 'codex' }, title: 'Codex' };
        await runs.runMachineItemUpdate(codex, { scope: { serverId: serverA, accountId: 'account-a' } });

        expect(rpc.machineRpc).toHaveBeenCalledWith(expect.objectContaining({
            method: 'daemon.agents.install.start', payload: { agentId: 'codex', intent: 'update', consent: { vendorRecipe: true } },
        }));
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), codex.id)).toMatchObject({
            running: false,
            errorMessage: 'agentInstallJob.verificationBody',
        });
    });

    it('after an agent update the machine\'s facts are re-read fresh, with the latest version, through the capability cache', async () => {
        rpc.detect.mockClear();
        rpc.invoke.mockImplementation(async () => ({ supported: true, response: { ok: true, result: { previousVersion: '2.1.281', version: '2.1.283' } } }));
        const claude: UpdateItem = { ...remoteCli, id: 'studio:agent:claude', subject: { kind: 'agent-cli', agentId: 'claude' }, title: 'Claude' };
        await runs.runMachineItemUpdate(claude, { scope: { serverId: serverA, accountId: 'account-a' } });
        await advance(0);

        expect(rpc.detect).toHaveBeenCalledWith(
            'studio',
            expect.objectContaining({
                bypassCache: true,
                requests: expect.arrayContaining([{ id: 'cli.claude', params: { includeLatestVersion: true } }]),
            }),
            expect.objectContaining({ serverId: serverA }),
        );
    });

    it('a runtime that finds the tool already current reports "Already up to date", never a failure or "Updated"', async () => {
        const claude: UpdateItem = { ...remoteCli, id: 'studio:agent:claude', subject: { kind: 'agent-cli', agentId: 'claude' }, title: 'Claude', currentVersion: '2.1.283' };
        await runs.runMachineItemUpdate(claude, { scope: { serverId: serverA, accountId: 'account-a' } });
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns(serverA), claude.id)).toMatchObject({
            running: false,
            errorMessage: null,
            alreadyCurrent: true,
        });
        expect(runs.readUnseenUpdateCompletions({ serverId: serverA, accountId: 'account-a' }).size).toBe(0);
    });
});
