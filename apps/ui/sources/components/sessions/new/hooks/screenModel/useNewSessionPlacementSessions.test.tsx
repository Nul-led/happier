import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderHook } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';

import { useNewSessionPlacementSessions } from './useNewSessionPlacementSessions';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

describe('useNewSessionPlacementSessions', () => {
    afterEach(() => {
        storage.setState({ sessions: {}, isDataReady: false });
    });

    it('keeps its sessions through activity-only rewrites and changes when a session moves or arrives', async () => {
        const first = createSessionFixture({ id: 's1', createdAt: 1, metadata: { path: '/w/app', host: 'mac', machineId: 'm1' } as never });
        storage.setState({ sessions: { s1: first }, isDataReady: true });
        let renders = 0;
        const hook = await renderHook(() => {
            renders += 1;
            return useNewSessionPlacementSessions();
        });
        const initial = hook.getCurrent();
        expect(initial?.map((session) => session.id)).toEqual(['s1']);
        const rendersAfterMount = renders;

        // The session works: its record is rewritten, but where it ran is unchanged.
        await act(async () => {
            storage.setState({ sessions: { s1: { ...first, updatedAt: 99, active: true, thinking: true } } });
        });
        expect(hook.getCurrent()).toBe(initial);
        expect(renders).toBe(rendersAfterMount);

        // A new session starts somewhere: placement history changed.
        const second = createSessionFixture({ id: 's2', createdAt: 2, metadata: { path: '/w/site', host: 'mac', machineId: 'm1' } as never });
        await act(async () => {
            storage.setState({ sessions: { s1: first, s2: second } });
        });
        expect(hook.getCurrent()?.map((session) => session.id)).toEqual(['s1', 's2']);

        // Its folder changes.
        await act(async () => {
            storage.setState({ sessions: { s1: first, s2: { ...second, metadata: { path: '/w/other', host: 'mac', machineId: 'm1' } as never } } });
        });
        expect(hook.getCurrent()?.[1]?.metadata?.path).toBe('/w/other');

        await hook.unmount();
    });
});
