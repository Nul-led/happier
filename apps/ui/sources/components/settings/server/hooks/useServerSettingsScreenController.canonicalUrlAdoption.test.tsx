import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import type { ActiveServerSwitchResult } from '@/sync/domains/server/activeServerSwitch';
import type { ServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const replaceMock = vi.fn();

const refreshFromActiveServerMock = vi.fn(async () => {});
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ refreshFromActiveServer: refreshFromActiveServerMock }),
}));

const modalConfirmMock = vi.fn(async (..._args: unknown[]) => true);

installServerSettingsHooksCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { replace: replaceMock },
            params: {},
        });
        return routerMock.module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: vi.fn(),
                confirm: (...args: unknown[]) => modalConfirmMock(...args),
            },
        }).module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSettingMutable: () => [[], vi.fn()],
        });
    },
});

const setActiveServerAndSwitchMock = vi.hoisted(() => vi.fn(
    async (): Promise<ActiveServerSwitchResult> => 'switched',
));
vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: setActiveServerAndSwitchMock,
}));

const upsertServerProfileMock = vi.fn((..._args: unknown[]): ServerProfile => ({
    id: 'p0',
    serverUrl: 'http://example.test',
    name: 'Example',
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: 0,
}));
const adoptHomeProfileMock = vi.fn(async (..._args: unknown[]): Promise<ServerProfile> =>
    upsertServerProfileMock(..._args));
const getServerProfileByIdMock = vi.fn((id: string) => {
    const profile = upsertServerProfileMock.mock.results
        .map((result) => result.value)
        .reverse()
        .find((value) => value?.id === id);
    return profile ?? null;
});
const removeServerProfileMock = vi.fn((..._args: unknown[]) => undefined);
const listServerProfilesMock = vi.fn<() => ServerProfile[]>(() => []);
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-a', serverUrl: 'https://a.example.test', generation: 1 }),
    listServerProfiles: () => listServerProfilesMock(),
    getActiveServerId: () => '',
    getDeviceDefaultServerId: () => '',
    getServerProfileById: (...args: [string]) => getServerProfileByIdMock(...args),
    getTabActiveServerId: () => null,
    getResetToDefaultServerId: () => '',
    clearTabActiveServerId: vi.fn(),
    subscribeActiveServer: vi.fn(() => () => {}),
    getServerProfilesGeneration: () => 0,
    subscribeServerProfiles: vi.fn(() => () => {}),
    subscribeHomeViewState: vi.fn(() => () => {}),
    loadHomeViewState: () => null,
    saveHomeViewState: vi.fn(),
    upsertServerProfile: (...args: unknown[]) => upsertServerProfileMock(...args),
    adoptHomeProfile: (...args: unknown[]) => adoptHomeProfileMock(...args),
    removeServerProfile: (...args: unknown[]) => removeServerProfileMock(...args),
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => profile.serverIdentityId ?? profile.id,
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
}));

vi.mock('@/sync/domains/server/serverConfig', () => ({
    validateServerUrl: () => ({ valid: true, error: null }),
}));

vi.mock('@/sync/domains/server/selection/serverSelectionMutations', () => ({
    normalizeStoredServerSelectionGroups: (raw: unknown) => (Array.isArray(raw) ? raw : []),
    filterServerSelectionGroupsToAvailableServers: (profiles: any) => profiles,
}));

vi.mock('@/components/settings/server/hooks/useServerAuthStatusByServerId', () => ({
    useServerAuthStatusByServerId: () => ({}),
}));

vi.mock('@/components/settings/server/hooks/useServerAutoAddFromRoute', () => ({
    useServerAutoAddFromRoute: () => {},
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsServerProfileActions', () => ({
    useServerSettingsServerProfileActions: () => ({
        onSwitchServer: vi.fn(async () => {}),
        onRenameServer: vi.fn(async () => {}),
        onRemoveServer: vi.fn(async () => {}),
    }),
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsGroupActions', () => ({
    useServerSettingsGroupActions: () => ({
        onSwitchGroup: vi.fn(async () => {}),
        onRenameGroup: vi.fn(async () => {}),
        onRemoveGroup: vi.fn(async () => {}),
        onCreateServerGroup: vi.fn(async () => false),
    }),
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsConcurrentActions', () => ({
    useServerSettingsConcurrentActions: () => ({
        onTogglePresentation: vi.fn(),
        onToggleConcurrentServer: vi.fn(),
    }),
}));

const runtimeFetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchMock(...args),
}));

function createReadyServerFeaturesSnapshot(params: Readonly<{
    canonicalServerUrl: string;
    serverIdentityId?: string | null;
}>): ServerFeaturesSnapshot {
    return {
        status: 'ready',
        features: createRootLayoutFeaturesResponse({
            capabilities: {
                server: { canonicalServerUrl: params.canonicalServerUrl },
                serverIdentity: { serverIdentityId: params.serverIdentityId ?? null },
            },
        }),
    };
}

const getServerFeaturesSnapshotMock = vi.fn(async (..._args: unknown[]): Promise<ServerFeaturesSnapshot> => (
    createReadyServerFeaturesSnapshot({
        canonicalServerUrl: 'https://canonical.example.test',
    })
));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: (...args: unknown[]) => getServerFeaturesSnapshotMock(...args),
}));

describe('useServerSettingsScreenController (canonical URL adoption)', () => {
    beforeEach(() => {
        refreshFromActiveServerMock.mockClear();
        modalConfirmMock.mockClear();
        upsertServerProfileMock.mockReset();
        adoptHomeProfileMock.mockClear();
        getServerProfileByIdMock.mockReset();
        removeServerProfileMock.mockReset();
        listServerProfilesMock.mockReset();
        listServerProfilesMock.mockReturnValue([]);
        setActiveServerAndSwitchMock.mockReset();
        setActiveServerAndSwitchMock.mockResolvedValue('switched');
        runtimeFetchMock.mockClear();
        getServerFeaturesSnapshotMock.mockReset();
        getServerFeaturesSnapshotMock.mockResolvedValue(createReadyServerFeaturesSnapshot({
            canonicalServerUrl: 'https://canonical.example.test',
        }));
    });

    it('adopts a manually entered Home without changing the focused Home', async () => {
        upsertServerProfileMock.mockReturnValueOnce({
            id: 'p1',
            serverUrl: 'https://manual-home.example.test',
            name: 'My Home',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce(createReadyServerFeaturesSnapshot({
            canonicalServerUrl: 'https://manual-home.example.test',
            serverIdentityId: 'manual_home_identity',
        }));
        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');
        let value: any = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }
        await renderScreen(React.createElement(Probe));
        await act(async () => {
            value.onChangeUrl('https://manual-home.example.test');
            value.onChangeName('My Home');
        });
        await act(async () => {
            await value.onAddServer();
        });

        expect(adoptHomeProfileMock).toHaveBeenCalledWith({
            descriptor: expect.objectContaining({
                serverUrl: 'https://manual-home.example.test',
                canonicalServerUrl: 'https://manual-home.example.test',
                homeServerIdentityId: 'manual_home_identity',
                displayName: 'My Home',
            }),
            source: 'manual',
            preserveUserLabel: true,
        });
        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
    });

    it('offers to adopt canonicalServerUrl from /v1/features and migrates the stored profile', async () => {
        upsertServerProfileMock
            .mockReturnValueOnce({ id: 'p1', serverUrl: 'http://127.0.0.1:3005', name: 'Local', createdAt: 0, updatedAt: 0, lastUsedAt: 0 })
            .mockReturnValueOnce({ id: 'p2', serverUrl: 'https://canonical.example.test', name: 'Local', createdAt: 0, updatedAt: 0, lastUsedAt: 0 });

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: any = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        await act(async () => {
            value.onChangeUrl('http://127.0.0.1:3005');
            value.onChangeName('Local');
        });

        await act(async () => {
            await value.onAddServer();
        });

        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'p1' }));
        expect(modalConfirmMock).toHaveBeenCalled();
        expect(adoptHomeProfileMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                descriptor: expect.objectContaining({ canonicalServerUrl: 'https://canonical.example.test' }),
            }),
        );
        expect(removeServerProfileMock).toHaveBeenCalledWith('p1');
        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
    });

    it('does not delete an existing same-url profile while adopting a canonical URL', async () => {
        const existingProfile = {
            id: 'p1',
            serverUrl: 'http://127.0.0.1:3005',
            name: 'Existing local',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        };
        listServerProfilesMock.mockReturnValue([existingProfile]);
        upsertServerProfileMock
            .mockReturnValueOnce(existingProfile)
            .mockReturnValueOnce({
                id: 'p2',
                serverUrl: 'https://canonical.example.test',
                name: 'Existing local',
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 0,
            });

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: any = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));
        await act(async () => {
            value.onChangeUrl(existingProfile.serverUrl);
            value.onChangeName(existingProfile.name);
        });
        await act(async () => {
            await value.onAddServer();
        });

        expect(removeServerProfileMock).not.toHaveBeenCalled();
    });

    it('persists the stable server identity without activating it', async () => {
        upsertServerProfileMock
            .mockReturnValueOnce({
                id: 'p1',
                serverUrl: 'http://127.0.0.1:3005',
                name: 'Local',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
            })
            .mockReturnValueOnce({
                id: 'p2',
                serverUrl: 'https://canonical.example.test',
                name: 'Local',
                serverIdentityId: 'srv_identity_manual',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
            });
        getServerProfileByIdMock.mockReturnValueOnce({
            id: 'p2',
            serverUrl: 'https://canonical.example.test',
            name: 'Local',
            serverIdentityId: 'srv_identity_manual',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        });

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: any = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        await act(async () => {
            value.onChangeUrl('http://127.0.0.1:3005');
            value.onChangeName('Local');
        });

        await act(async () => {
            await value.onAddServer();
        });

        expect(adoptHomeProfileMock).toHaveBeenCalledWith(expect.objectContaining({
            descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_identity_manual' }),
        }));
        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
    });
});
