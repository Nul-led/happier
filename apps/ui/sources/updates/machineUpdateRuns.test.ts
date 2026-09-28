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
}));

vi.mock('@/sync/ops', () => ({
    machineCapabilitiesInvoke: (...args: unknown[]) => rpc.invoke(...args),
    // The capability cache owner's detect RPC: the facts re-read after an update.
    machineCapabilitiesDetect: (...args: unknown[]) => rpc.detect(...args),
}));

import type { UpdateItem } from './items/updateItem';
import * as runs from './machineUpdateRuns';

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

const accountA = { serverId: 'server-a', accountId: 'account-a' } as const;
const otherServer = { serverId: 'server-b', accountId: 'account-a' } as const;

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

async function advanceRemotePoll(): Promise<void> {
    // `runMachineItemUpdate` reaches the poll timer through several awaited RPC boundaries. Wait
    // for the first poll to return before advancing it; module-owned background timers can already
    // exist, so timer count alone cannot tell us the update poll's delay has been scheduled.
    for (let attempts = 0; attempts < 100 && !rpc.invoke.mock.calls.some((call) => call[1]?.method === 'poll'); attempts += 1) {
        await Promise.resolve();
    }
    expect(rpc.invoke.mock.calls.some((call) => call[1]?.method === 'poll')).toBe(true);
    for (let attempts = 0; attempts < 20 && rpc.invoke.mock.calls.filter((call) => call[1]?.method === 'poll').length < 2; attempts += 1) {
        await vi.advanceTimersToNextTimerAsync();
        await Promise.resolve();
    }
    expect(rpc.invoke.mock.calls.filter((call) => call[1]?.method === 'poll')).toHaveLength(2);
}

describe('runMachineItemUpdate — a remote CLI update is started, then observed', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        runs.markUpdateCompletionsSeen(accountA);
        runs.markUpdateCompletionsSeen(otherServer);
        rpc.invoke.mockReset();
        rpc.pollResults = [];
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
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), remoteCli.id, { lastUpdateSignature: '' });

        const done = runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
        await advance(0);
        seenSteps.push(String(read().step));
        await advanceRemotePoll();
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
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), remoteCli.id, { lastUpdateSignature: '' });

        const done = runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
        await advance(0);
        expect(read()).toMatchObject({ running: true, step: 'installing' });
        await advanceRemotePoll();
        await done;
        expect(read()).toMatchObject({ running: true, step: 'reconnecting' });
    });

    it('another update holding the lock is a retryable refusal, never "installing" (its lock may not be this update)', async () => {
        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: false, error: { code: 'cli_update_in_progress', message: 'busy' } },
        ];
        vi.useRealTimers();
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), remoteCli.id, { lastUpdateSignature: '' });
        const done = runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
        await done;
        expect(read()).toMatchObject({ running: false, errorMessage: 'updates.row.anotherUpdateRunning' });

        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        await runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
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
        const read = () => runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), remoteCli.id, { lastUpdateSignature: '' });
        const done = runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
        await done;
        seen.push(String(read().step));
        expect(read()).toMatchObject({ running: false, errorMessage: 'updates.row.outcomeUnknown' });
        expect(seen).not.toContain('reconnecting');
        expect(runs.readUnseenUpdateCompletions(accountA).size).toBe(0);

        installRpc();
        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        await runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
        expect(read()).toMatchObject({ running: true, step: 'reconnecting', errorMessage: null });
        expect(runs.readUnseenUpdateCompletions(accountA).get(remoteCli.id)).toBe('pendingRemote');
    });

    it('a machine\'s unseen "Updated" belongs to its server: opening Updates on another server keeps it', async () => {
        rpc.pollResults = [
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        const done = runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
        await done;
        runs.markUpdateCompletionsSeen(otherServer);
        expect(runs.readUnseenUpdateCompletions(accountA).get(remoteCli.id)).toBe('pendingRemote');
        expect(runs.readUnseenUpdateCompletions(otherServer).size).toBe(0);
        runs.markUpdateCompletionsSeen(accountA);
        expect(runs.readUnseenUpdateCompletions(accountA).size).toBe(0);
    });

    it('raw installer output never becomes the row\'s sentence; its log stays behind View log', async () => {
        rpc.invoke.mockImplementation(async () => ({
            supported: true,
            response: { ok: false, error: { message: 'npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/x', code: 'install-failed' }, logPath: '/logs/codex.log' },
        }));
        const codex: UpdateItem = { ...remoteCli, id: 'studio:agent:codex', subject: { kind: 'agent-cli', agentId: 'codex' }, title: 'Codex' };
        await runs.runMachineItemUpdate(codex, { scope: accountA });
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), codex.id)).toMatchObject({
            running: false,
            errorMessage: 'updates.row.failedGeneric',
            logPath: '/logs/codex.log',
        });
    });

    it('an in-flight update stays attached to the server it started on, even after switching servers', async () => {
        rpc.pollResults = [
            null,
            null,
            { protocolVersion: 1, taskId: 'task-1', ok: true, data: { started: true, currentVersion: '0.2.12', channel: 'stable', logPath: '/l' } },
        ];
        const done = runs.runMachineItemUpdate(remoteCli, { scope: accountA, lastUpdateSignature: '' });
        await advance(5_000);
        await done;

        // Start and every poll go to the original server, never to whichever server is active now.
        expect(rpc.invoke.mock.calls.length).toBeGreaterThanOrEqual(3);
        for (const call of rpc.invoke.mock.calls) expect(call[2]).toMatchObject({ serverId: 'server-a' });
        // The run belongs to that server's rows only.
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), remoteCli.id, { lastUpdateSignature: '' }).running).toBe(true);
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-b'), remoteCli.id, { lastUpdateSignature: '' }).running).toBe(false);
    });

    it('an explicit press runs the vendor updater without asking again, and shows the runtime\'s own reason', async () => {
        rpc.invoke.mockImplementation(async () => ({
            supported: true,
            response: { ok: false, error: { message: 'npm won’t install a release less than a day old.', code: 'update-not-verified' } },
        }));
        const codex: UpdateItem = { ...remoteCli, id: 'studio:agent:codex', subject: { kind: 'agent-cli', agentId: 'codex' }, title: 'Codex' };
        await runs.runMachineItemUpdate(codex, { scope: accountA });

        expect(rpc.invoke.mock.calls[0]?.[1]).toMatchObject({ method: 'install', params: { intent: 'update', allowVendorRecipeExecution: true } });
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), codex.id)).toMatchObject({
            running: false,
            errorMessage: 'npm won’t install a release less than a day old.',
        });
    });

    it('after an agent update the machine\'s facts are re-read fresh, with the latest version, through the capability cache', async () => {
        rpc.detect.mockClear();
        rpc.invoke.mockImplementation(async () => ({ supported: true, response: { ok: true, result: { previousVersion: '2.1.281', version: '2.1.283' } } }));
        const claude: UpdateItem = { ...remoteCli, id: 'studio:agent:claude', subject: { kind: 'agent-cli', agentId: 'claude' }, title: 'Claude' };
        await runs.runMachineItemUpdate(claude, { scope: accountA });
        await advance(0);

        expect(rpc.detect).toHaveBeenCalledWith(
            'studio',
            expect.objectContaining({
                bypassCache: true,
                requests: expect.arrayContaining([{ id: 'cli.claude', params: { includeLatestVersion: true } }]),
            }),
            expect.objectContaining({ serverId: 'server-a' }),
        );
    });

    it('a runtime that finds the tool already current reports "Already up to date", never a failure or "Updated"', async () => {
        rpc.invoke.mockImplementation(async () => ({ supported: true, response: { ok: true, result: { alreadyCurrent: true, version: '2.1.283' } } }));
        const claude: UpdateItem = { ...remoteCli, id: 'studio:agent:claude', subject: { kind: 'agent-cli', agentId: 'claude' }, title: 'Claude' };
        await runs.runMachineItemUpdate(claude, { scope: accountA });
        expect(runs.observeMachineUpdateRun(runs.readMachineUpdateRuns('server-a'), claude.id)).toMatchObject({
            running: false,
            errorMessage: null,
            alreadyCurrent: true,
        });
        expect(runs.readUnseenUpdateCompletions(accountA).size).toBe(0);
    });
});
