import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { flushHookEffects, renderHook } from '@/dev/testkit';
import type { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import type {
    getProviderAccountUsageSnapshotPlain,
    getProviderAccountUsageSnapshotSealed,
} from '@/sync/api/account/apiProviderAccountUsage';
import {
    ProviderAccountUsageSnapshotV1Schema,
    buildProviderAccountUsageRecordId,
    type ProviderAccountUsageSnapshotV1,
} from '@happier-dev/protocol';
import * as hookModule from './useProviderAccountUsageSnapshots';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stableCredentials = { token: 't', secret: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') } as const;
let currentCredentials: Readonly<{ token: string; secret: string }> = stableCredentials;
const activeServerSnapshotState = {
    current: {
        serverId: 'server-a',
        serverUrl: 'https://server-a.example.test',
        generation: 1,
    },
};

const useFeatureEnabledSpy = vi.fn((_featureId: string) => true);

const {
    fetchAccountEncryptionModeSpy,
    getProviderAccountUsageSnapshotPlainSpy,
    getProviderAccountUsageSnapshotSealedSpy,
    runtime,
} = vi.hoisted(() => ({
    runtime: { active: true, listeners: new Set<() => void>() },
    fetchAccountEncryptionModeSpy: vi.fn<
        (...args: Parameters<typeof fetchAccountEncryptionMode>) => ReturnType<typeof fetchAccountEncryptionMode>
    >(async () => ({ mode: 'plain', updatedAt: 0 })),
    getProviderAccountUsageSnapshotPlainSpy: vi.fn<
        (...args: Parameters<typeof getProviderAccountUsageSnapshotPlain>) => ReturnType<typeof getProviderAccountUsageSnapshotPlain>
    >(async () => null),
    getProviderAccountUsageSnapshotSealedSpy: vi.fn<
        (...args: Parameters<typeof getProviderAccountUsageSnapshotSealed>) => ReturnType<typeof getProviderAccountUsageSnapshotSealed>
    >(async () => null),
}));

// Visibility signals are an environment boundary; exercise the real runtime hook.
vi.mock('@/utils/runtime/isRuntimeActive', () => ({
    isRuntimeActive: () => runtime.active,
    subscribeToRuntimeActiveChange: (listener: () => void) => {
        runtime.listeners.add(listener);
        return () => runtime.listeners.delete(listener);
    },
}));

async function setRuntimeActive(active: boolean): Promise<void> {
    await act(async () => {
        runtime.active = active;
        for (const listener of [...runtime.listeners]) listener();
    });
    await flushHookEffects({ cycles: 5, turns: 5 });
}

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: currentCredentials }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => useFeatureEnabledSpy(featureId),
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => activeServerSnapshotState.current,
}));

vi.mock('@/sync/api/account/apiAccountEncryptionMode', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/account/apiAccountEncryptionMode')>(),
    fetchAccountEncryptionMode: fetchAccountEncryptionModeSpy,
}));

vi.mock('@/sync/api/account/apiProviderAccountUsage', () => ({
    getProviderAccountUsageSnapshotPlain: getProviderAccountUsageSnapshotPlainSpy,
    getProviderAccountUsageSnapshotSealed: getProviderAccountUsageSnapshotSealedSpy,
}));

function makeUsageSnapshot(params: Readonly<{
    accountSubjectId?: string;
    staleAfterMs?: number;
    meterId?: string;
}> = {}): ProviderAccountUsageSnapshotV1 {
    const fetchedAtMs = Date.now();
    const recordKey = {
        providerId: 'codex',
        accountSubjectId: params.accountSubjectId ?? 'acct_stable',
        subjectKind: 'account',
        quotaScope: 'account',
    } satisfies ProviderAccountUsageSnapshotV1['recordKey'];
    return ProviderAccountUsageSnapshotV1Schema.parse({
        v: 1,
        recordId: buildProviderAccountUsageRecordId(recordKey),
        recordKey,
        providerId: 'codex',
        accountSubject: {
            kind: 'providerSubject',
            id: recordKey.accountSubjectId,
        },
        observedAtMs: fetchedAtMs,
        fetchedAtMs,
        staleAfterMs: params.staleAfterMs ?? 60_000,
        source: 'runtimeSignal',
        confidence: 'confirmed',
        state: 'loaded_data',
        planLabel: 'Plus',
        accountLabel: 'Work',
        meters: [
            {
                meterId: params.meterId ?? 'weekly',
                label: params.meterId ?? 'weekly',
                used: 40,
                limit: 100,
                unit: 'count',
                utilizationPct: null,
                remainingPct: 60,
                resetsAt: null,
                status: 'ok',
                confidence: 'exact',
                details: { limitCategory: 'usage_limit' },
            },
        ],
    });
}

async function loadHook() {
    return hookModule;
}

describe('useProviderAccountUsageSnapshots', () => {
    beforeEach(() => {
        runtime.active = true;
        currentCredentials = stableCredentials;
        activeServerSnapshotState.current = {
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            generation: 1,
        };
        // Mounted hooks release their real cache entries on unmount. Do not
        // rebuild the full application import graph between isolated mounts.
        vi.clearAllMocks();
        useFeatureEnabledSpy.mockReturnValue(true);
        fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('parks background readers and immediately refreshes retained data on foreground return', async () => {
        vi.useFakeTimers();
        runtime.active = false;
        const snapshot = makeUsageSnapshot();
        getProviderAccountUsageSnapshotPlainSpy.mockResolvedValue(snapshot);
        const { useProviderAccountUsageSnapshots } = await loadHook();
        const hook = await renderHook(() => useProviderAccountUsageSnapshots([snapshot.recordId]));
        try {
            await flushHookEffects({ cycles: 5, turns: 5 });
            expect(getProviderAccountUsageSnapshotPlainSpy).not.toHaveBeenCalled();
            await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
            expect(getProviderAccountUsageSnapshotPlainSpy).not.toHaveBeenCalled();
            await setRuntimeActive(true);
            expect(hook.getCurrent().snapshotsByRecordId[snapshot.recordId]).toEqual(snapshot);
            expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledTimes(1);
            await setRuntimeActive(false);
            await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
            expect(hook.getCurrent().snapshotsByRecordId[snapshot.recordId]).toEqual(snapshot);
            const refreshed = { ...snapshot, fetchedAtMs: Date.now() };
            getProviderAccountUsageSnapshotPlainSpy.mockResolvedValue(refreshed);
            await setRuntimeActive(true);
            expect(hook.getCurrent().snapshotsByRecordId[snapshot.recordId]).toEqual(refreshed);
            expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledTimes(2);
            await setRuntimeActive(false);
            await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
            expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledTimes(2);
        } finally {
            await hook.unmount();
            expect(runtime.listeners.size).toBe(0);
        }
    });

    it('loads canonical usage by record id without exposing connected-service quota projections', async () => {
        const snapshot = makeUsageSnapshot();
        getProviderAccountUsageSnapshotPlainSpy.mockResolvedValue(snapshot);

        const { useProviderAccountUsageSnapshots } = await loadHook();
        const hook = await renderHook(() => useProviderAccountUsageSnapshots([snapshot.recordId]));
        await flushHookEffects({ cycles: 5, turns: 5 });

        expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledWith(stableCredentials, {
            recordId: snapshot.recordId,
        }, {
            signal: expect.any(AbortSignal),
            expectedActiveServer: {
                serverId: 'server-a',
                generation: 1,
            },
        });
        expect(hook.getCurrent().snapshotsByRecordId[snapshot.recordId]?.recordId).toBe(snapshot.recordId);
        expect(hook.getCurrent().stateByRecordId[snapshot.recordId]).toBe('loaded_data');
        expect('connectedServiceSnapshotsByKey' in hook.getCurrent()).toBe(false);
        await hook.unmount();
    });

    it('selects the plaintext route exclusively even when that route has no snapshot', async () => {
        const snapshot = makeUsageSnapshot();
        getProviderAccountUsageSnapshotPlainSpy.mockResolvedValue(null);

        const { useProviderAccountUsageSnapshots } = await loadHook();
        const hook = await renderHook(() =>
            useProviderAccountUsageSnapshots([snapshot.recordId]));
        await flushHookEffects({ cycles: 5, turns: 5 });

        expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledOnce();
        expect(
            getProviderAccountUsageSnapshotSealedSpy,
        ).not.toHaveBeenCalled();
        expect(
            hook.getCurrent().snapshotsByRecordId[snapshot.recordId],
        ).toBeNull();
        await hook.unmount();
    });

    it('does not expose or reuse a prior server cache after the active server changes', async () => {
        const serverASnapshot = makeUsageSnapshot({ meterId: 'server-a' });
        const serverBSnapshot = ProviderAccountUsageSnapshotV1Schema.parse({
            ...serverASnapshot,
            meters: [{
                ...serverASnapshot.meters[0]!,
                meterId: 'server-b',
                label: 'server-b',
            }],
        });
        getProviderAccountUsageSnapshotPlainSpy.mockImplementation(
            async (_credentials, _params, options) =>
                options?.expectedActiveServer?.serverId === 'server-b'
                    ? serverBSnapshot
                    : serverASnapshot,
        );

        const { useProviderAccountUsageSnapshots } = await loadHook();
        const hook = await renderHook(() =>
            useProviderAccountUsageSnapshots([serverASnapshot.recordId]));
        await flushHookEffects({ cycles: 5, turns: 5 });
        expect(
            hook.getCurrent().snapshotsByRecordId[
                serverASnapshot.recordId
            ]?.meters[0]?.meterId,
        ).toBe('server-a');

        activeServerSnapshotState.current = {
            serverId: 'server-b',
            serverUrl: 'https://server-b.example.test',
            generation: 2,
        };
        await hook.rerender();
        expect(
            hook.getCurrent().snapshotsByRecordId[
                serverASnapshot.recordId
            ]?.meters[0]?.meterId,
        ).not.toBe('server-a');
        await flushHookEffects({ cycles: 5, turns: 5 });

        expect(
            hook.getCurrent().snapshotsByRecordId[
                serverASnapshot.recordId
            ]?.meters[0]?.meterId,
        ).toBe('server-b');
        expect(
            getProviderAccountUsageSnapshotPlainSpy,
        ).toHaveBeenLastCalledWith(
            stableCredentials,
            { recordId: serverASnapshot.recordId },
            {
                signal: expect.any(AbortSignal),
                expectedActiveServer: {
                    serverId: 'server-b',
                    generation: 2,
                },
            },
        );
        await hook.unmount();
    });

    it('does not commit a prior generation under the same active server', async () => {
        const generationOneSnapshot =
            makeUsageSnapshot({ meterId: 'generation-1' });
        const generationTwoSnapshot =
            ProviderAccountUsageSnapshotV1Schema.parse({
                ...generationOneSnapshot,
                meters: [{
                    ...generationOneSnapshot.meters[0]!,
                    meterId: 'generation-2',
                    label: 'generation-2',
                }],
            });
        getProviderAccountUsageSnapshotPlainSpy.mockImplementation(
            async (_credentials, _params, options) =>
                options?.expectedActiveServer?.generation === 2
                    ? generationTwoSnapshot
                    : generationOneSnapshot,
        );

        const { useProviderAccountUsageSnapshots } = await loadHook();
        const hook = await renderHook(() =>
            useProviderAccountUsageSnapshots([
                generationOneSnapshot.recordId,
            ]));
        await flushHookEffects({ cycles: 5, turns: 5 });
        expect(
            hook.getCurrent().snapshotsByRecordId[
                generationOneSnapshot.recordId
            ]?.meters[0]?.meterId,
        ).toBe('generation-1');

        activeServerSnapshotState.current = {
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            generation: 2,
        };
        await hook.rerender();
        expect(
            hook.getCurrent().snapshotsByRecordId[
                generationOneSnapshot.recordId
            ]?.meters[0]?.meterId,
        ).not.toBe('generation-1');
        await flushHookEffects({ cycles: 5, turns: 5 });

        expect(
            hook.getCurrent().snapshotsByRecordId[
                generationOneSnapshot.recordId
            ]?.meters[0]?.meterId,
        ).toBe('generation-2');
        expect(
            getProviderAccountUsageSnapshotPlainSpy,
        ).toHaveBeenLastCalledWith(
            stableCredentials,
            { recordId: generationOneSnapshot.recordId },
            {
                signal: expect.any(AbortSignal),
                expectedActiveServer: {
                    serverId: 'server-a',
                    generation: 2,
                },
            },
        );
        await hook.unmount();
    });

    it('settles every loading record and preserves last-known-good usage when refreshes fail', async () => {
        vi.useFakeTimers();
        const snapshot = makeUsageSnapshot({ staleAfterMs: 1, meterId: 'weekly' });
        const sibling = makeUsageSnapshot({ accountSubjectId: 'acct_second', staleAfterMs: 1, meterId: 'daily' });
        const snapshots = new Map([snapshot, sibling].map((value) => [value.recordId, value]));
        let failRefresh = false;
        getProviderAccountUsageSnapshotPlainSpy.mockImplementation(async (_credentials, { recordId }) => {
            if (failRefresh) throw new Error('temporary');
            return snapshots.get(recordId) ?? null;
        });

        const { useProviderAccountUsageSnapshots } = await loadHook();
        const hook = await renderHook(() => useProviderAccountUsageSnapshots([snapshot.recordId, sibling.recordId]));
        await flushHookEffects({ cycles: 5, turns: 5 });

        for (const value of snapshots.values()) {
            expect(hook.getCurrent().snapshotsByRecordId[value.recordId]).toEqual(value);
        }
        failRefresh = true;
        await flushHookEffects({ cycles: 1, turns: 2, advanceTimersMs: 30_001 });
        await flushHookEffects({ cycles: 5, turns: 5 });

        expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledTimes(4);
        for (const value of snapshots.values()) {
            expect(hook.getCurrent().snapshotsByRecordId[value.recordId]).toEqual(value);
            expect(hook.getCurrent().stateByRecordId[value.recordId]).toBe('error_last_known_good');
            expect(hook.getCurrent().loadingByRecordId[value.recordId]).toBe(false);
        }
        await hook.unmount();
    });

    it('serves canonical cache entries in cache-only mode without refetching', async () => {
        const snapshot = makeUsageSnapshot();
        getProviderAccountUsageSnapshotPlainSpy.mockResolvedValue(snapshot);

        const { useProviderAccountUsageSnapshots } = await loadHook();

        function Loader() {
            useProviderAccountUsageSnapshots([snapshot.recordId]);
            return null;
        }

        let tree!: renderer.ReactTestRenderer;
        await act(async () => {
            tree = renderer.create(React.createElement(Loader));
        });
        await flushHookEffects({ cycles: 5, turns: 5 });
        expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledTimes(1);

        const hook = await renderHook(() => useProviderAccountUsageSnapshots([snapshot.recordId], {
            fetchPolicy: 'cache_only',
        }));

        expect(hook.getCurrent().snapshotsByRecordId[snapshot.recordId]?.recordId).toBe(snapshot.recordId);
        expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledTimes(1);
        await hook.unmount();
        await act(async () => {
            tree.unmount();
        });
    });

    it('publishes all independently settled records in one batched cache update', async () => {
        const first = makeUsageSnapshot({ accountSubjectId: 'first' });
        const second = makeUsageSnapshot({ accountSubjectId: 'second' });
        let releaseFirst!: () => void;
        let releaseSecond!: () => void;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
        getProviderAccountUsageSnapshotPlainSpy.mockImplementation(async (_credentials, params) => {
            if (params.recordId === first.recordId) {
                await firstGate;
                return first;
            }
            await secondGate;
            return second;
        });

        const { useProviderAccountUsageSnapshots } = await loadHook();
        const cache = await import('@/sync/domains/connectedServices/accountUsage/providerAccountUsageCache');
        const hook = await renderHook(() =>
            useProviderAccountUsageSnapshots([first.recordId, second.recordId]));
        await flushHookEffects({ cycles: 5, turns: 5 });
        expect(getProviderAccountUsageSnapshotPlainSpy).toHaveBeenCalledTimes(2);

        const listener = vi.fn();
        const unsubscribe = cache.subscribeProviderAccountUsageCache(listener);
        releaseFirst();
        releaseSecond();
        await flushHookEffects({ cycles: 5, turns: 5 });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().snapshotsByRecordId[first.recordId]).toEqual(first);
        expect(hook.getCurrent().snapshotsByRecordId[second.recordId]).toEqual(second);

        unsubscribe();
        await hook.unmount();
        expect(cache.getProviderAccountUsageCacheState().entriesByCredentialScope)
            .toEqual({});
    });

    it('publishes a fast record while a slower sibling remains loading', async () => {
        const fast = makeUsageSnapshot({ accountSubjectId: 'fast' });
        const slow = makeUsageSnapshot({ accountSubjectId: 'slow' });
        let releaseSlow!: () => void;
        const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
        getProviderAccountUsageSnapshotPlainSpy.mockImplementation(async (_credentials, params) => {
            if (params.recordId === fast.recordId) return fast;
            await slowGate;
            return slow;
        });

        const { useProviderAccountUsageSnapshots } = await loadHook();
        const hook = await renderHook(() =>
            useProviderAccountUsageSnapshots([fast.recordId, slow.recordId]));
        await flushHookEffects({ cycles: 5, turns: 5 });

        expect(hook.getCurrent().snapshotsByRecordId[fast.recordId]).toEqual(fast);
        expect(hook.getCurrent().loadingByRecordId[fast.recordId]).toBe(false);
        expect(hook.getCurrent().snapshotsByRecordId[slow.recordId]).toBeNull();
        expect(hook.getCurrent().loadingByRecordId[slow.recordId]).toBe(true);

        releaseSlow();
        await flushHookEffects({ cycles: 5, turns: 5 });
        expect(hook.getCurrent().snapshotsByRecordId[slow.recordId]).toEqual(slow);
        await hook.unmount();
    });
});
