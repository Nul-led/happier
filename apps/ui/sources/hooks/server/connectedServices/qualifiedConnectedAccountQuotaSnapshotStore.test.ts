import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetQualifiedConnectedAccountQuotaSnapshotStore } from './qualifiedConnectedAccountQuotaSnapshotStore';

import {
    resolveConnectedServiceSettingsErrorMessage,
} from '@/components/settings/connectedServices/connectedServiceSettingsErrors';

const {
    getQuotaMock,
    requestRefreshMock,
    openQuotaMock,
    machineRpcMock,
} = vi.hoisted(() => ({
    getQuotaMock: vi.fn(),
    requestRefreshMock: vi.fn(),
    openQuotaMock: vi.fn(),
    machineRpcMock: vi.fn(),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcMock,
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-a', serverUrl: 'https://server-a.test', generation: 1 }),
}));

vi.mock('@/sync/api/account/apiQualifiedConnectedAccountsV4', () => ({
    getQualifiedConnectedAccountQuotaV4: getQuotaMock,
    requestQualifiedConnectedAccountQuotaRefreshV4: requestRefreshMock,
}));

vi.mock(
    '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials',
    () => ({
        resolveAccountScopedCryptoMaterialFromCredentials: () => ({
            type: 'legacy',
        }),
    }),
);

vi.mock('@happier-dev/protocol', async (importOriginal) => ({
    ...await importOriginal<typeof import('@happier-dev/protocol')>(),
    openQualifiedConnectedAccountQuotaResponseV4: openQuotaMock,
}));

const credentials = {
    token: 'token',
    secret: 'secret',
};
const ref = {
    service: {
        pluginId: 'happier.agent.claude',
        localId: 'anthropic',
    },
    accountId: 'work',
};
const sourceResolution = { recordId: 'pau-record' };

function buildContext(serverId: string, generation: number) {
    return {
        credentials,
        credentialScope: `${serverId}\u0000credentials`,
        ref,
        serverBasis: {
            serverId,
            generation,
        },
        assertOperationAllowed: vi.fn(async () => {}),
    };
}

async function flushAsyncTurns(turns = 8): Promise<void> {
    for (let index = 0; index < turns; index += 1) {
        await Promise.resolve();
    }
}

describe('qualifiedConnectedAccountQuotaSnapshotStore', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        __resetQualifiedConnectedAccountQuotaSnapshotStore();
    });

    it.each([
        { fetchPolicy: 'poll', refused: false },
        { fetchPolicy: 'once', refused: false },
        { fetchPolicy: 'once', refused: true },
    ] as const)('reloads the consumed account in the admitted Home generation without requesting another provider refresh ($fetchPolicy, refused=$refused)', async ({ fetchPolicy, refused }) => {
        const snapshot = { v: 1, ref, fetchedAt: 1, staleAfterMs: 60_000, planLabel: null, accountLabel: null, meters: [] };
        getQuotaMock.mockResolvedValue({ ref, sourceResolution });
        openQuotaMock.mockReturnValue(snapshot);
        const store = await import('./qualifiedConnectedAccountQuotaSnapshotStore');
        const current = buildContext('server-a', 1);
        const other = buildContext('server-b', 1);
        const currentKey = store.buildQualifiedQuotaSnapshotScopeKey(current);
        const otherKey = store.buildQualifiedQuotaSnapshotScopeKey(other);
        const releaseOther = store.retainQualifiedQuotaSnapshotPolling(otherKey, other);
        const releaseCurrent = fetchPolicy === 'poll'
            ? store.retainQualifiedQuotaSnapshotPolling(currentKey, current)
            : store.loadQualifiedQuotaSnapshotOnce(currentKey, current);
        await flushAsyncTurns();
        const refreshed = { ...snapshot, fetchedAt: 2, recoveryCredits: { availableCount: 1, credits: [] } };
        openQuotaMock.mockReturnValue(refreshed);
        const receipt = { idempotencyKey: 'manual-1', status: refused ? 'not_available' : 'consumed' };
        machineRpcMock.mockResolvedValue(refused
            ? { ok: false, errorCode: 'connected_service_quota_recovery_credit_not_available', error: 'unavailable', receipt }
            : { ok: true, receipt, snapshot: null });
        const { connectedServiceQuotaRecoveryCreditConsume } = await import('@/sync/ops/connectedServiceQuotaRecoveryCredits');
        const result = await connectedServiceQuotaRecoveryCreditConsume({ machineId: 'machine-1', serviceId: 'anthropic', profileId: ref.accountId });
        expect(result).toMatchObject({ ok: !refused, receipt });
        expect(store.getQualifiedQuotaSnapshotEntry(currentKey).snapshot).toEqual(refreshed);
        expect(store.getQualifiedQuotaSnapshotEntry(otherKey).snapshot).toEqual(snapshot);
        expect(requestRefreshMock).not.toHaveBeenCalled();
        releaseCurrent();
        releaseOther();
    });

    it('deduplicates the qualified read across concurrent consumers', async () => {
        const response = { ref, sourceResolution };
        const snapshot = {
            v: 1,
            ref,
            fetchedAt: 1,
            staleAfterMs: 60_000,
            planLabel: null,
            accountLabel: null,
            meters: [],
        };
        getQuotaMock.mockResolvedValue(response);
        openQuotaMock.mockReturnValue(snapshot);
        const {
            buildQualifiedQuotaSnapshotScopeKey,
            getQualifiedQuotaSnapshotEntry,
            retainQualifiedQuotaSnapshotPolling,
        } = await import('./qualifiedConnectedAccountQuotaSnapshotStore');
        const context = buildContext('server-a', 1);
        const key = buildQualifiedQuotaSnapshotScopeKey(context);

        const releaseFirst =
            retainQualifiedQuotaSnapshotPolling(key, context);
        const releaseSecond =
            retainQualifiedQuotaSnapshotPolling(key, context);
        await flushAsyncTurns();

        expect(getQuotaMock).toHaveBeenCalledOnce();
        expect(getQualifiedQuotaSnapshotEntry(key)).toEqual(
            expect.objectContaining({
                snapshot,
                supported: true,
                loading: false,
                error: null,
            }),
        );
        releaseFirst();
        releaseSecond();
    });

    it('isolates cache identity by active-server generation', async () => {
        getQuotaMock.mockImplementation(
            async (_credentials, _ref, options) => ({
                ref,
                sourceResolution,
                serverId: options?.expectedActiveServer?.serverId,
            }),
        );
        openQuotaMock.mockImplementation(({ response }) => ({
            v: 1,
            ref,
            fetchedAt: response.serverId === 'server-b' ? 2 : 1,
            staleAfterMs: 60_000,
            planLabel: null,
            accountLabel: null,
            meters: [{
                meterId: response.serverId,
                label: response.serverId,
                used: 0,
                limit: 1,
                unit: 'count',
                utilizationPct: 0,
                resetsAt: null,
                status: 'ok',
                confidence: 'exact',
                details: {},
            }],
        }));
        const {
            buildQualifiedQuotaSnapshotScopeKey,
            getQualifiedQuotaSnapshotEntry,
            retainQualifiedQuotaSnapshotPolling,
        } = await import('./qualifiedConnectedAccountQuotaSnapshotStore');
        const serverA = buildContext('server-a', 1);
        const serverB = buildContext('server-b', 2);
        const keyA = buildQualifiedQuotaSnapshotScopeKey(serverA);
        const keyB = buildQualifiedQuotaSnapshotScopeKey(serverB);

        const releaseA = retainQualifiedQuotaSnapshotPolling(keyA, serverA);
        await flushAsyncTurns();
        const releaseB = retainQualifiedQuotaSnapshotPolling(keyB, serverB);
        await flushAsyncTurns();

        expect(keyB).not.toBe(keyA);
        expect(
            getQualifiedQuotaSnapshotEntry(keyA)
                .snapshot?.meters[0]?.meterId,
        ).toBe('server-a');
        expect(
            getQualifiedQuotaSnapshotEntry(keyB)
                .snapshot?.meters[0]?.meterId,
        ).toBe('server-b');
        releaseA();
        releaseB();
    });

    it('keeps the last-known-good snapshot and localizes a failed refresh', async () => {
        const snapshot = {
            v: 1,
            ref,
            fetchedAt: 1,
            staleAfterMs: 60_000,
            planLabel: null,
            accountLabel: null,
            meters: [],
        };
        const failure = Object.assign(new Error('not found'), {
            code: 'connect_group_not_found',
        });
        getQuotaMock.mockResolvedValue({ ref, sourceResolution });
        openQuotaMock.mockReturnValue(snapshot);
        requestRefreshMock.mockRejectedValue(failure);
        const {
            buildQualifiedQuotaSnapshotScopeKey,
            getQualifiedQuotaSnapshotEntry,
            refreshQualifiedQuotaSnapshot,
            retainQualifiedQuotaSnapshotPolling,
        } = await import('./qualifiedConnectedAccountQuotaSnapshotStore');
        const context = buildContext('server-a', 1);
        const key = buildQualifiedQuotaSnapshotScopeKey(context);

        const release = retainQualifiedQuotaSnapshotPolling(key, context);
        await flushAsyncTurns();
        await refreshQualifiedQuotaSnapshot(key, context);

        expect(getQualifiedQuotaSnapshotEntry(key)).toEqual(
            expect.objectContaining({
                snapshot,
                supported: true,
                refreshing: false,
                error: resolveConnectedServiceSettingsErrorMessage(failure),
            }),
        );
        release();
    });

    it('does not claim quota support when the first read fails', async () => {
        const failure = Object.assign(new Error('unavailable'), {
            code: 'connected_account_v4_operation_unsupported',
        });
        getQuotaMock.mockRejectedValue(failure);
        const {
            buildQualifiedQuotaSnapshotScopeKey,
            getQualifiedQuotaSnapshotEntry,
            retainQualifiedQuotaSnapshotPolling,
        } = await import('./qualifiedConnectedAccountQuotaSnapshotStore');
        const context = buildContext('server-a', 1);
        const key = buildQualifiedQuotaSnapshotScopeKey(context);

        const release = retainQualifiedQuotaSnapshotPolling(key, context);
        await flushAsyncTurns();

        expect(getQualifiedQuotaSnapshotEntry(key)).toEqual(
            expect.objectContaining({
                snapshot: null,
                supported: null,
                loading: false,
                error: resolveConnectedServiceSettingsErrorMessage(failure),
            }),
        );
        release();
    });

    it('backs off exponentially while consecutive quota reads keep failing', async () => {
        vi.useFakeTimers();
        try {
            const snapshot = {
                v: 1,
                ref,
                fetchedAt: 1,
                staleAfterMs: 30_000,
                planLabel: null,
                accountLabel: null,
                meters: [],
            };
            openQuotaMock.mockReturnValue(snapshot);
            getQuotaMock.mockRejectedValue(new Error('unavailable'));
            const {
                buildQualifiedQuotaSnapshotScopeKey,
                retainQualifiedQuotaSnapshotPolling,
            } = await import('./qualifiedConnectedAccountQuotaSnapshotStore');
            const context = buildContext('server-a', 1);
            const key = buildQualifiedQuotaSnapshotScopeKey(context);

            const release = retainQualifiedQuotaSnapshotPolling(key, context);
            await flushAsyncTurns();
            expect(getQuotaMock).toHaveBeenCalledTimes(1);

            // One consecutive failure retries at the 30s floor.
            await vi.advanceTimersByTimeAsync(30_000);
            await flushAsyncTurns();
            expect(getQuotaMock).toHaveBeenCalledTimes(2);

            // Two consecutive failures must double the wait instead of
            // hammering the same failing account every 30s forever.
            await vi.advanceTimersByTimeAsync(30_000);
            await flushAsyncTurns();
            expect(getQuotaMock).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(30_000);
            await flushAsyncTurns();
            expect(getQuotaMock).toHaveBeenCalledTimes(3);

            // A success clears the ladder: the next poll is back at the floor.
            getQuotaMock.mockResolvedValue({ ref, sourceResolution });
            await vi.advanceTimersByTimeAsync(120_000);
            await flushAsyncTurns();
            expect(getQuotaMock).toHaveBeenCalledTimes(4);

            getQuotaMock.mockRejectedValue(new Error('unavailable again'));
            await vi.advanceTimersByTimeAsync(30_000);
            await flushAsyncTurns();
            expect(getQuotaMock).toHaveBeenCalledTimes(5);
            await vi.advanceTimersByTimeAsync(30_000);
            await flushAsyncTurns();
            expect(getQuotaMock).toHaveBeenCalledTimes(6);

            release();
        } finally {
            vi.useRealTimers();
        }
    });

    it('evicts released entries only once their credential scope is superseded', async () => {
        const snapshot = {
            v: 1,
            ref,
            fetchedAt: 1,
            staleAfterMs: 60_000,
            planLabel: null,
            accountLabel: null,
            meters: [],
        };
        getQuotaMock.mockResolvedValue({ ref, sourceResolution });
        openQuotaMock.mockReturnValue(snapshot);
        const {
            buildQualifiedQuotaSnapshotScopeKey,
            getQualifiedQuotaSnapshotEntry,
            retainQualifiedQuotaSnapshotPolling,
        } = await import('./qualifiedConnectedAccountQuotaSnapshotStore');
        const serverA = buildContext('server-a', 1);
        const serverB = buildContext('server-b', 2);
        const keyA = buildQualifiedQuotaSnapshotScopeKey(serverA);
        const keyB = buildQualifiedQuotaSnapshotScopeKey(serverB);

        const releaseA = retainQualifiedQuotaSnapshotPolling(keyA, serverA);
        await flushAsyncTurns();
        releaseA();

        // Unmounting the only reader keeps the cached snapshot: remounting the
        // same account under the same credential scope must not flash empty.
        expect(getQualifiedQuotaSnapshotEntry(keyA).snapshot).toEqual(snapshot);

        const releaseB = retainQualifiedQuotaSnapshotPolling(keyB, serverB);
        await flushAsyncTurns();

        expect(getQualifiedQuotaSnapshotEntry(keyA).snapshot).toBeNull();
        expect(getQualifiedQuotaSnapshotEntry(keyB).snapshot).toEqual(snapshot);
        releaseB();
    });
});
