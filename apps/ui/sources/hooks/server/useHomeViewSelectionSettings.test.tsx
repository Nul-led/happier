import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';

const homeViewState = vi.hoisted(() => ({
    value: null as null | {
        version: 1;
        groups: readonly unknown[];
        activeTargetKind: 'server' | 'group' | null;
        activeTargetId: string | null;
    },
}));

vi.mock('@/sync/domains/server/selection/homeViewSelectionState', () => ({
    loadEffectiveHomeViewState: () => homeViewState.value,
    subscribeEffectiveHomeViewState: () => () => {},
    updateEffectiveHomeViewState: () => {
        throw new Error('not exercised by this test');
    },
}));

describe('useHomeViewSelectionSettings', () => {
    afterEach(() => {
        standardCleanup();
        homeViewState.value = null;
    });

    it('reads the legacy Home-view fallback without subscribing to unrelated Account settings', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { useHomeViewSelectionSettings } = await import('./useHomeViewSelectionSettings');

        let renderCount = 0;
        const hook = await renderHook(() => {
            renderCount += 1;
            return useHomeViewSelectionSettings();
        });

        expect(hook.getCurrent().serverSelectionActiveTargetId).toBeNull();
        const rendersAfterMount = renderCount;

        await act(async () => {
            getStorage().getState().applySettingsLocal({ lastUsedAgent: 'claude' });
        });

        // A Home-view reader must not rerender for an unrelated Account setting.
        // Persistent surfaces (header/sidebar connection control, session lists)
        // mount this hook for the whole session.
        expect(renderCount).toBe(rendersAfterMount);

        await act(async () => {
            getStorage().getState().applySettingsLocal({
                serverSelectionActiveTargetKind: 'server',
                serverSelectionActiveTargetId: 'srv-legacy',
            });
        });

        expect(renderCount).toBeGreaterThan(rendersAfterMount);
        expect(hook.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'srv-legacy',
        });
    });

    it('prefers the device-global Home-view owner over the legacy Account-scoped keys', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { useHomeViewSelectionSettings } = await import('./useHomeViewSelectionSettings');

        getStorage().getState().applySettingsLocal({
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'srv-legacy',
        });
        homeViewState.value = {
            version: 1,
            groups: [],
            activeTargetKind: 'server',
            activeTargetId: 'srv-device-global',
        };

        const hook = await renderHook(() => useHomeViewSelectionSettings());

        expect(hook.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'srv-device-global',
        });
    });
});
