import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol';
import { SESSION_MACHINE_TARGET_UNAVAILABLE_ERROR_CODE } from '@/sync/runtime/sessionMachineRpcErrorCodes';
const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcWithServerScopeMock,
}));

afterEach(() => {
    machineRpcWithServerScopeMock.mockReset();
});

describe('searchDaemonMemory', () => {
    it('calls daemon memory search through server-scoped machine RPC and parses hits', async () => {
        machineRpcWithServerScopeMock.mockResolvedValueOnce({
            v: 1,
            ok: true,
            hits: [{
                sessionId: 'session-1',
                seqFrom: 2,
                seqTo: 4,
                createdAtFromMs: 10,
                createdAtToMs: 20,
                summary: 'Vector cache summary',
                score: 0.72,
            }],
        });

        const { searchDaemonMemory } = await import('./searchDaemonMemory');
        const result = await searchDaemonMemory({
            serverId: 'server-a',
            accountId: 'account-a',
            machineId: 'machine-a',
            query: ' vector cache ',
            scope: { type: 'global' },
            mode: 'auto',
            maxResults: 20,
            timeoutMs: 1500,
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            serverId: 'server-a',
            accountId: 'account-a',
            machineId: 'machine-a',
            method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
            payload: {
                v: 1,
                query: 'vector cache',
                scope: { type: 'global' },
                mode: 'auto',
                maxResults: 20,
            },
            timeoutMs: 1500,
            preferScoped: true,
        });
        expect(result).toEqual({
            v: 1,
            ok: true,
            hits: [{
                sessionId: 'session-1',
                seqFrom: 2,
                seqTo: 4,
                createdAtFromMs: 10,
                createdAtToMs: 20,
                summary: 'Vector cache summary',
                score: 0.72,
            }],
        });
    });

    it('normalizes daemon memory search unavailability into a non-fatal result', async () => {
        machineRpcWithServerScopeMock.mockRejectedValueOnce(Object.assign(new Error('RPC method not available'), {
            rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
        }));

        const { searchDaemonMemory } = await import('./searchDaemonMemory');
        const result = await searchDaemonMemory({
            serverId: 'server-a',
            accountId: 'account-a',
            machineId: 'machine-a',
            query: 'vector cache',
            scope: { type: 'global' },
            mode: 'auto',
        });

        expect(result).toMatchObject({
            v: 1,
            ok: false,
            errorCode: 'memory_index_missing',
        });
    });

    it('preserves machine-target unavailability as a transport/reachability outcome', async () => {
        const unavailable = Object.assign(new Error('Machine target is offline'), {
            rpcErrorCode: SESSION_MACHINE_TARGET_UNAVAILABLE_ERROR_CODE,
        });
        machineRpcWithServerScopeMock.mockRejectedValueOnce(unavailable);

        const { searchDaemonMemory } = await import('./searchDaemonMemory');
        await expect(searchDaemonMemory({
            serverId: 'server-a',
            accountId: 'account-a',
            machineId: 'machine-a',
            query: 'vector cache',
            scope: { type: 'global' },
            mode: 'auto',
        })).rejects.toBe(unavailable);
    });

    it('sends contextual Session eligibility and rejects unfiltered legacy hits', async () => {
        machineRpcWithServerScopeMock.mockResolvedValueOnce({
            v: 1,
            ok: true,
            hits: [{
                sessionId: 'active-session',
                seqFrom: 1,
                seqTo: 1,
                createdAtFromMs: 1,
                createdAtToMs: 1,
                summary: 'Legacy daemon ignored eligibility',
                score: 1,
            }, {
                sessionId: 'archived-session',
                seqFrom: 1,
                seqTo: 1,
                createdAtFromMs: 1,
                createdAtToMs: 1,
                summary: 'Eligible archived result',
                score: 0.9,
            }],
        });

        const { searchDaemonMemory } = await import('./searchDaemonMemory');
        const result = await searchDaemonMemory({
            serverId: 'server-a',
            accountId: 'account-a',
            machineId: 'machine-a',
            query: 'vector cache',
            scope: { type: 'global' },
            mode: 'auto',
            eligibleSessionIds: ['archived-session'],
            maxResults: 20,
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({ eligibleSessionIds: ['archived-session'] }),
        }));
        expect(result).toEqual(expect.objectContaining({
            ok: true,
            hits: [expect.objectContaining({ sessionId: 'archived-session' })],
        }));
    });

    it('threads the caller AbortSignal into the incumbent machine RPC cancellation path', async () => {
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ v: 1, ok: true, hits: [] });
        const controller = new AbortController();

        const { searchDaemonMemory } = await import('./searchDaemonMemory');
        await searchDaemonMemory({
            serverId: 'server-a',
            accountId: 'account-a',
            machineId: 'machine-a',
            query: 'vector cache',
            scope: { type: 'global' },
            mode: 'auto',
            signal: controller.signal,
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(
            expect.objectContaining({ signal: controller.signal }),
        );
    });

    it('reports an already-aborted request without issuing a machine RPC', async () => {
        const controller = new AbortController();
        controller.abort();

        const { searchDaemonMemory } = await import('./searchDaemonMemory');
        await expect(searchDaemonMemory({
            serverId: 'server-a',
            accountId: 'account-a',
            machineId: 'machine-a',
            query: 'vector cache',
            scope: { type: 'global' },
            mode: 'auto',
            signal: controller.signal,
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
    });
});
