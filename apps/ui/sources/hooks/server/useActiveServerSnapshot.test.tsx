import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderHook } from '@/dev/testkit';

const getActiveServerSnapshotMock = vi.hoisted(() => vi.fn());
const subscribeActiveServerMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: getActiveServerSnapshotMock,
    subscribeActiveServer: subscribeActiveServerMock,
}));

describe('useActiveServerSnapshot', () => {
    beforeEach(() => {
        getActiveServerSnapshotMock.mockReset();
        subscribeActiveServerMock.mockReset();
        subscribeActiveServerMock.mockImplementation(() => () => {});
    });

    it('reads the latest active server snapshot on mount even if it changed before the subscription effect attached', async () => {
        let currentSnapshot = { serverId: 'server-a', serverUrl: 'http://api.example.test', generation: 1 };
        getActiveServerSnapshotMock.mockImplementation(() => currentSnapshot);
        subscribeActiveServerMock.mockImplementationOnce(() => {
            currentSnapshot = { serverId: 'server-b', serverUrl: 'http://api.override.test', generation: 2 };
            return () => {};
        });

        const { useActiveServerSnapshot } = await import('./useActiveServerSnapshot');
        const hook = await renderHook(() => useActiveServerSnapshot());

        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent()).toEqual(currentSnapshot);
    });

    it('updates when the runtime mutates the same snapshot object before notifying subscribers', async () => {
        const currentSnapshot = { serverId: 'server-a', serverUrl: 'http://api.example.test', generation: 1 };
        let activeServerListener: (() => void) | null = null;
        getActiveServerSnapshotMock.mockImplementation(() => currentSnapshot);
        subscribeActiveServerMock.mockImplementation((listener: () => void) => {
            activeServerListener = listener;
            return () => {};
        });

        const { useActiveServerSnapshot } = await import('./useActiveServerSnapshot');
        const hook = await renderHook(() => {
            const snapshot = useActiveServerSnapshot();
            return { serverUrl: snapshot.serverUrl };
        });

        expect(hook.getCurrent().serverUrl).toBe('http://api.example.test');

        currentSnapshot.serverUrl = 'http://api.other.test';
        currentSnapshot.generation = 2;
        await act(async () => {
            activeServerListener?.();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().serverUrl).toBe('http://api.other.test');
    });

    it('does not republish routine consumers when only diagnostic Iroh path facts change', async () => {
        const currentSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://home.example.test',
            generation: 1,
            connectionDescriptorRevision: 4,
            runtimeOrigin: 'http://127.0.0.1:45100',
            carrier: 'iroh' as const,
            irohObservedPath: 'direct' as 'direct' | 'relay',
            irohRelayPolicy: 'automatic' as 'automatic' | 'disabled',
        };
        let activeServerListener: (() => void) | null = null;
        getActiveServerSnapshotMock.mockImplementation(() => currentSnapshot);
        subscribeActiveServerMock.mockImplementation((listener: () => void) => {
            activeServerListener = listener;
            return () => {};
        });

        const { useActiveServerSnapshot } = await import('./useActiveServerSnapshot');
        const hook = await renderHook(() => useActiveServerSnapshot());
        const initialSnapshot = hook.getCurrent();

        currentSnapshot.irohObservedPath = 'relay';
        currentSnapshot.irohRelayPolicy = 'disabled';
        await act(async () => {
            activeServerListener?.();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent()).toBe(initialSnapshot);
    });

    it('does not subscribe or read the active server while disabled', async () => {
        getActiveServerSnapshotMock.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'http://api.example.test',
            generation: 1,
        });
        const unsubscribe = vi.fn();
        subscribeActiveServerMock.mockReturnValue(unsubscribe);

        const { useActiveServerSnapshot } = await import('./useActiveServerSnapshot');
        const hook = await renderHook(
            (enabled: boolean) => useActiveServerSnapshot(enabled),
            { initialProps: false },
        );

        expect(hook.getCurrent().serverId).toBe('');
        expect(getActiveServerSnapshotMock).not.toHaveBeenCalled();
        expect(subscribeActiveServerMock).not.toHaveBeenCalled();

        await hook.rerender(true);

        expect(hook.getCurrent().serverId).toBe('server-a');
        expect(subscribeActiveServerMock).toHaveBeenCalledTimes(1);

        await hook.rerender(false);

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().serverId).toBe('');
        await hook.unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
