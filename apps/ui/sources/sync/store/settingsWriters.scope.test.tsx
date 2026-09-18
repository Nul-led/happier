import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';

const mocks = vi.hoisted(() => ({
    applySettings: vi.fn(),
}));

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({ applySettings: mocks.applySettings }),
}));

import { useApplySettings } from './settingsWriters';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useApplySettings Account scope binding', () => {
    let previousState: ReturnType<typeof storage.getState>;

    beforeEach(() => {
        previousState = storage.getState();
        mocks.applySettings.mockReset();
        storage.setState((state) => ({
            ...state,
            settingsScope: { serverId: 'server-a', accountId: 'account-a' },
        }));
    });

    afterEach(() => {
        standardCleanup();
        storage.setState(previousState, true);
    });

    it('retains the rendered Account scope while a newly rendered writer binds the new scope', async () => {
        const hook = await renderHook(() => useApplySettings());
        const writerA = hook.getCurrent();

        await act(async () => {
            storage.setState((state) => ({
                ...state,
                settingsScope: { serverId: 'server-b', accountId: 'account-b' },
            }));
        });
        const writerB = hook.getCurrent();

        writerA({ analyticsOptOut: true });
        writerB({ analyticsOptOut: false });

        expect(writerB).not.toBe(writerA);
        expect(mocks.applySettings).toHaveBeenNthCalledWith(1, { analyticsOptOut: true }, {
            expectedSettingsScope: { serverId: 'server-a', accountId: 'account-a' },
            source: 'ui',
        });
        expect(mocks.applySettings).toHaveBeenNthCalledWith(2, { analyticsOptOut: false }, {
            expectedSettingsScope: { serverId: 'server-b', accountId: 'account-b' },
            source: 'ui',
        });
    });

    it('keeps a retained useSettingMutable setter bound to the Account that rendered it', async () => {
        const hook = await renderHook(() => useSettingMutable('sessionListSectionModeV1'));
        const setterA = hook.getCurrent()[1];

        await act(async () => {
            storage.setState((state) => ({
                ...state,
                settingsScope: { serverId: 'server-b', accountId: 'account-b' },
            }));
        });
        const setterB = hook.getCurrent()[1];

        setterA('single');
        setterB('activity');

        expect(setterB).not.toBe(setterA);
        expect(mocks.applySettings).toHaveBeenNthCalledWith(1, { sessionListSectionModeV1: 'single' }, {
            expectedSettingsScope: { serverId: 'server-a', accountId: 'account-a' },
            source: 'ui',
        });
        expect(mocks.applySettings).toHaveBeenNthCalledWith(2, { sessionListSectionModeV1: 'activity' }, {
            expectedSettingsScope: { serverId: 'server-b', accountId: 'account-b' },
            source: 'ui',
        });
    });
});
