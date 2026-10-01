import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localSettingsDefaults } from '@/sync/domains/settings/localSettings';
import { loadLocalSettings } from '@/sync/domains/state/settingsPersistence';
import { clearPersistence } from '@/sync/domains/state/persistence';

const store = vi.hoisted(() => new Map<string, string>());

// MMKV is the persistence boundary; everything above it (store, apply, persistence module) is real.
vi.mock('react-native-mmkv', () => {
    class MMKV {
        getString(key: string) {
            return store.get(key);
        }

        set(key: string, value: string) {
            store.set(key, value);
        }

        delete(key: string) {
            store.delete(key);
        }

        clearAll() {
            store.clear();
        }
    }

    return { MMKV };
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => key,
        translateLoose: (key: string) => key,
        getPreferredLanguage: () => 'en',
    });
});

import { createSettingsDomain } from './settings';

type SettingsDomainApi = ReturnType<typeof createSettingsDomain>;

// The same neighbouring-slice shape the other settings-domain tests use, so projection helpers
// that read sibling slices see realistic empty state.
type TestState = SettingsDomainApi & Readonly<{
    sessions: {};
    machines: {};
    machineDisplayById: {};
    sessionListRowsByServerId: {};
    ordinarySessionListMembershipByServerId: {};
    archivedSessionListMembershipByServerId: {};
    sessionListIndexByServerId: {};
    concurrentSessionListCacheByServerId: {};
    machineListByServerId: {};
    getProjectForSession: undefined;
}>;

function createTestStore(): { getState: () => TestState } {
    let state = {
        sessions: {},
        machines: {},
        machineDisplayById: {},
        sessionListRowsByServerId: {},
        ordinarySessionListMembershipByServerId: {},
        archivedSessionListMembershipByServerId: {},
        sessionListIndexByServerId: {},
        concurrentSessionListCacheByServerId: {},
        machineListByServerId: {},
        getProjectForSession: undefined,
    } as TestState;

    const set = (updater: ((current: TestState) => Partial<TestState> | TestState) | Partial<TestState>) => {
        const next = typeof updater === 'function' ? updater(state) : updater;
        state = { ...state, ...next };
    };
    const domain = createSettingsDomain<TestState>({ set, get: () => state });
    state = { ...state, ...(domain as SettingsDomainApi) };

    return { getState: () => state };
}

describe('local settings applied without persisting', () => {
    beforeEach(() => {
        clearPersistence();
        store.clear();
    });

    it('updates the runtime text scale while the persisted value stays unchanged', () => {
        const { getState } = createTestStore();

        getState().applyLocalSettings({ uiFontScale: 1.1 }, { persist: false });

        expect(getState().localSettings.uiFontScale).toBe(1.1);
        expect(loadLocalSettings().uiFontScale).toBe(localSettingsDefaults.uiFontScale);
    });

    it('still persists ordinary local setting changes', () => {
        const { getState } = createTestStore();

        getState().applyLocalSettings({ uiFontScale: 1.2 });

        expect(loadLocalSettings().uiFontScale).toBe(1.2);
    });
});
