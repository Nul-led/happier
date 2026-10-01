import { beforeEach, describe, expect, it, vi } from 'vitest';

// Machine RPC routing/transport is the daemon boundary of this spawn client.
const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcWithServerScopeMock,
}));

import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { SessionSpawnNewInputV2 } from '@happier-dev/protocol';
import { readSpawnSessionRpcTimeoutMsFromEnv } from '@/sync/domains/session/spawn/spawnSessionRpcTimeout';
import { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedRpcTypes';
import { MACHINE_RPC_TIMEOUT_ERROR_CODE } from '@/sync/runtime/orchestration/serverScopedRpc/machineRpcTimeoutError';
import { createSocketIoAckTimeoutError } from '@happier-dev/sync-client';
import { createRpcCallError } from '@/sync/runtime/rpcErrors';

import { dispatchSessionSpawnNewToMachine } from './sessionSpawnNewAction';

const payload = {
    executionTarget: { serverId: 'server-a', machineId: 'machine-a' },
    creationKey: 'manual:attempt-a',
} as unknown as SessionSpawnNewInputV2;
const createMachineRpcTimeoutError = () => Object.assign(new Error('Machine RPC timed out'), {
    code: MACHINE_RPC_TIMEOUT_ERROR_CODE,
});

describe('session.spawn_new daemon dispatch', () => {
    beforeEach(() => {
        machineRpcWithServerScopeMock.mockReset();
    });

    it('waits for the daemon for the Session spawn budget, not the generic machine RPC default', async () => {
        machineRpcWithServerScopeMock.mockResolvedValue({ type: 'pending', retryWithSameCreationKey: true, outcome: 'accepted' });

        await dispatchSessionSpawnNewToMachine({ payload });

        const request = machineRpcWithServerScopeMock.mock.calls[0]?.[0];
        expect(request).toMatchObject({ serverId: 'server-a', machineId: 'machine-a', method: RPC_METHODS.SESSION_SPAWN_NEW });
        // A daemon that answers after the generic 30 s default (the observed
        // stall was 23 s plus client/relay overhead) is still inside this budget.
        expect(request.timeoutMs).toBeGreaterThan(DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS);
        expect(request.timeoutMs).toBe(readSpawnSessionRpcTimeoutMsFromEnv());
    });

    it.each([
        ['socket acknowledgement', createSocketIoAckTimeoutError],
        ['machine RPC setup', createMachineRpcTimeoutError],
    ] as const)('reports a %s timeout before issuance as a retryable failure without claiming a Session may exist', async (_kind, timeout) => {
        machineRpcWithServerScopeMock.mockRejectedValue(timeout());

        await expect(dispatchSessionSpawnNewToMachine({ payload })).resolves.toEqual({
            type: 'error',
            code: 'machine_offline',
            retryable: true,
        });
        expect(machineRpcWithServerScopeMock.mock.calls[0]?.[0]).toMatchObject({
            onIssued: expect.any(Function),
        });
    });

    it.each([
        ['socket acknowledgement', createSocketIoAckTimeoutError],
        ['machine RPC deadline', createMachineRpcTimeoutError],
    ] as const)('settles an emitted spawn after a %s timeout as outcome-unknown, to retry with the same creation key', async (_kind, timeout) => {
        machineRpcWithServerScopeMock.mockImplementation(async (request: { onIssued?: () => void }) => {
            request.onIssued?.();
            throw timeout();
        });

        await expect(dispatchSessionSpawnNewToMachine({ payload })).resolves.toEqual({
            type: 'pending',
            retryWithSameCreationKey: true,
            outcome: 'unknown',
        });
    });

    it('keeps a definitive daemon refusal a typed failure rather than an unknown outcome', async () => {
        machineRpcWithServerScopeMock.mockRejectedValue(createRpcCallError({
            error: 'RPC method not available',
            errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
        }));

        await expect(dispatchSessionSpawnNewToMachine({ payload })).rejects.toMatchObject({
            rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
        });
    });
});
