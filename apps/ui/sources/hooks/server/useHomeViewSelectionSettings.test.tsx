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
    /** Set by the device-local selection test so the writer has a real owner to save through. */
    save: null as null | ((update: unknown, options: unknown) => unknown),
}));

const syncSingleton = vi.hoisted(() => ({ applySettings: vi.fn() }));

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => syncSingleton,
}));

vi.mock('@/sync/domains/server/selection/homeViewSelectionState', () => ({
    loadEffectiveHomeViewState: () => homeViewState.value,
    subscribeEffectiveHomeViewState: () => () => {},
    updateEffectiveHomeViewState: (update: unknown, options: unknown) => {
        if (!homeViewState.save) throw new Error('not exercised by this test');
        return homeViewState.save(update, options);
    },
}));

describe('useHomeViewSelectionSettings', () => {
    afterEach(() => {
        standardCleanup();
        homeViewState.value = null;
        homeViewState.save = null;
        syncSingleton.applySettings.mockClear();
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

    it('keeps Home selection device-local instead of entering the Account-settings writer', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { useHomeViewSelectionSettingsMutable } = await import('./useHomeViewSelectionSettings');

        const saved = {
            version: 1 as const,
            groups: [] as readonly unknown[],
            activeTargetKind: 'server' as const,
            activeTargetId: 'srv-device-global',
        };
        homeViewState.value = saved;
        const savedScopes: unknown[] = [];
        homeViewState.save = (_update, options) => {
            savedScopes.push(options);
            return saved;
        };

        const hook = await renderHook(() => useHomeViewSelectionSettingsMutable());
        await act(async () => {
            hook.getCurrent().setHomeViewSelectionSettings({
                serverSelectionGroups: [],
                serverSelectionActiveTargetKind: 'server',
                serverSelectionActiveTargetId: 'srv-device-global',
            });
        });

        // The device-global owner saved it, and the Settings projection exists only so existing
        // readers keep working. This is the one catalogued local-only exception: it must never
        // reach the scoped Account-settings writer, which would seal, queue and sync it to a
        // Home (Lane 07.6 §2, completion evidence 9).
        expect(savedScopes).toEqual([{ scope: 'device' }]);
        expect(getStorage().getState().settings.serverSelectionActiveTargetId).toBe('srv-device-global');
        expect(syncSingleton.applySettings).not.toHaveBeenCalled();
    });
});
