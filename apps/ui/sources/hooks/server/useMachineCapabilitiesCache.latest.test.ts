import { describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('latest machine capability answer', () => {
    it('follows the newest answer for a capability across freshness generations of the same machine', async () => {
        vi.resetModules();
        const answers = [['p-1'], []];
        // The daemon RPC boundary: each detect answers with the next pending-change list.
        vi.doMock('@/sync/ops', () => ({
            machineCapabilitiesDetect: vi.fn(async () => ({
                supported: true,
                response: {
                    protocolVersion: 1,
                    results: { 'tool.plugins': { ok: true, checkedAt: 1, data: { pendingChanges: answers.shift() } } },
                },
            })),
        }));
        const cache = await import('./useMachineCapabilitiesCache');
        const request = { requests: [{ id: 'tool.plugins' }] } as never;
        const pending = () => {
            const state = cache.getLatestMachineCapabilityCacheState('m1', 's1', 'tool.plugins');
            const snapshot = state && 'snapshot' in state ? state.snapshot : null;
            return (snapshot?.response.results['tool.plugins'] as any)?.data?.pendingChanges ?? null;
        };
        const notified = vi.fn();
        const unsubscribe = cache.subscribeLatestMachineCapabilityCacheState('m1', 's1', 'tool.plugins', notified);

        expect(cache.getLatestMachineCapabilityCacheUpdatedAt('m1', 's1', 'tool.plugins')).toBeNull();
        const before = Date.now();
        await cache.prefetchMachineCapabilities({ machineId: 'm1', serverId: 's1', cacheKeySalt: '3:0', request, timeoutMs: 1000 });
        expect(pending()).toEqual(['p-1']);
        // When this answer was received, for an honest "As of".
        expect(cache.getLatestMachineCapabilityCacheUpdatedAt('m1', 's1', 'tool.plugins')).toBeGreaterThanOrEqual(before);

        // The Plugins page reconnected and asked again under its next generation.
        await cache.prefetchMachineCapabilities({ machineId: 'm1', serverId: 's1', cacheKeySalt: '3:1', request, timeoutMs: 1000 });
        expect(pending()).toEqual([]);
        expect(notified).toHaveBeenCalled();

        // Another machine's answers are not this machine's.
        expect(cache.getLatestMachineCapabilityCacheState('m2', 's1', 'tool.plugins')).toBeNull();
        unsubscribe();
    });
});
