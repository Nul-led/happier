import * as React from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installServerSettingsHooksCommonModuleMocks();

vi.mock('@/sync/domains/server/serverConfig', () => ({
    validateServerUrl: () => ({ valid: true, error: null }),
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
    getServerProfileById: (...args: [string]) => getServerProfileByIdMock(...args),
    listServerProfiles: () => listServerProfilesMock(),
    upsertServerProfile: (...args: unknown[]) => upsertServerProfileMock(...args),
    adoptHomeProfile: (...args: unknown[]) => adoptHomeProfileMock(...args),
    removeServerProfile: (...args: unknown[]) => removeServerProfileMock(...args),
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => profile.serverIdentityId ?? profile.id,
}));

const getServerFeaturesSnapshotMock = vi.fn(async (..._args: unknown[]) => ({
    status: 'ready',
    features: {
        features: {},
        capabilities: {
            server: { canonicalServerUrl: 'https://canonical.example.test' },
            serverIdentity: { serverIdentityId: null as string | null },
        },
    },
}));
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: (...args: unknown[]) => getServerFeaturesSnapshotMock(...args),
}));

describe('useServerAutoAddFromRoute (canonical URL adoption)', () => {
    beforeEach(() => {
        upsertServerProfileMock.mockReset();
        adoptHomeProfileMock.mockClear();
        getServerProfileByIdMock.mockReset();
        removeServerProfileMock.mockReset();
        listServerProfilesMock.mockReset();
        listServerProfilesMock.mockReturnValue([]);
        getServerFeaturesSnapshotMock.mockReset();
        getServerFeaturesSnapshotMock.mockResolvedValue({
            status: 'ready',
            features: {
                features: {},
                capabilities: {
                    server: { canonicalServerUrl: 'https://canonical.example.test' },
                    serverIdentity: { serverIdentityId: null as string | null },
                },
            },
        });
    });

    it('adopts a route Home through the canonical owner without focusing it', async () => {
        upsertServerProfileMock.mockReturnValueOnce({
            id: 'p1',
            serverUrl: 'https://route-home.example.test',
            name: 'Route Home',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({
            status: 'ready',
            features: {
                features: {},
                capabilities: {
                    server: { canonicalServerUrl: 'https://route-home.example.test' },
                    serverIdentity: { serverIdentityId: 'route_home_identity' },
                },
            },
        });
        const onSwitchServerById = vi.fn(async () => {});
        const onAfterSuccess = vi.fn();
        const { useServerAutoAddFromRoute } = await import('./useServerAutoAddFromRoute');

        function Probe() {
            useServerAutoAddFromRoute({
                enabled: true,
                url: 'https://route-home.example.test',
                validateServerReachable: async () => true,
                setError: vi.fn(),
                onSwitchServerById,
                onAfterSuccess,
                source: 'url',
            });
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(adoptHomeProfileMock).toHaveBeenCalledWith({
            descriptor: expect.objectContaining({
                serverUrl: 'https://route-home.example.test',
                canonicalServerUrl: 'https://route-home.example.test',
                homeServerIdentityId: 'route_home_identity',
            }),
            source: 'url',
            preserveUserLabel: true,
        });
        expect(onSwitchServerById).not.toHaveBeenCalled();
        expect(onAfterSuccess).toHaveBeenCalled();
    });

    it('adopts canonicalServerUrl from /v1/features without prompting', async () => {
        upsertServerProfileMock
            .mockReturnValueOnce({ id: 'p1', serverUrl: 'http://127.0.0.1:3005', name: 'Local', createdAt: 0, updatedAt: 0, lastUsedAt: 0 })
            .mockReturnValueOnce({ id: 'p2', serverUrl: 'https://canonical.example.test', name: 'Local', createdAt: 0, updatedAt: 0, lastUsedAt: 0 });

        const onSwitchServerById = vi.fn(async () => {});
        const onAfterSuccess = vi.fn();

        const { useServerAutoAddFromRoute } = await import('./useServerAutoAddFromRoute');

        function Probe() {
            useServerAutoAddFromRoute({
                enabled: true,
                url: 'http://127.0.0.1:3005',
                validateServerReachable: async () => true,
                setError: vi.fn(),
                onSwitchServerById,
                onAfterSuccess,
                source: 'url',
            });
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'p1' }));
        expect(removeServerProfileMock).toHaveBeenCalledWith('p1');
        expect(onSwitchServerById).not.toHaveBeenCalled();
        expect(onAfterSuccess).toHaveBeenCalled();
    });

    it('does not treat an existing same-url profile as transient canonical-adoption state', async () => {
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

        const { useServerAutoAddFromRoute } = await import('./useServerAutoAddFromRoute');

        function Probe() {
            useServerAutoAddFromRoute({
                enabled: true,
                url: existingProfile.serverUrl,
                validateServerReachable: async () => true,
                setError: vi.fn(),
                onSwitchServerById: vi.fn(async () => {}),
                onAfterSuccess: vi.fn(),
                source: 'url',
            });
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(removeServerProfileMock).not.toHaveBeenCalled();
    });

    it('does not auto-adopt a canonicalServerUrl with a different host when the input URL looks shareable', async () => {
        upsertServerProfileMock.mockReturnValueOnce({ id: 'p1', serverUrl: 'http://public.example.test', name: 'Public', createdAt: 0, updatedAt: 0, lastUsedAt: 0 });

        getServerFeaturesSnapshotMock.mockResolvedValueOnce({
            status: 'ready',
            features: {
                features: {},
                capabilities: {
                    server: { canonicalServerUrl: 'https://canonical.example.test' },
                    serverIdentity: { serverIdentityId: null as string | null },
                },
            },
        });

        const onSwitchServerById = vi.fn(async () => {});
        const onAfterSuccess = vi.fn();

        const { useServerAutoAddFromRoute } = await import('./useServerAutoAddFromRoute');

        function Probe() {
            useServerAutoAddFromRoute({
                enabled: true,
                url: 'http://public.example.test',
                validateServerReachable: async () => true,
                setError: vi.fn(),
                onSwitchServerById,
                onAfterSuccess,
                source: 'url',
            });
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(removeServerProfileMock).not.toHaveBeenCalled();
        expect(onSwitchServerById).not.toHaveBeenCalled();
        expect(onAfterSuccess).toHaveBeenCalled();
    });

    it('adopts the learned stable identity without switching focus', async () => {
        upsertServerProfileMock.mockReturnValueOnce({
            id: 'p1',
            serverUrl: 'http://127.0.0.1:3005',
            name: 'Local',
            serverIdentityId: 'srv_identity_route',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        });
        getServerProfileByIdMock.mockReturnValueOnce({
            id: 'p1',
            serverUrl: 'http://127.0.0.1:3005',
            name: 'Local',
            serverIdentityId: 'srv_identity_route',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({
            status: 'ready',
            features: {
                features: {},
                capabilities: {
                    server: { canonicalServerUrl: 'http://127.0.0.1:3005' },
                    serverIdentity: { serverIdentityId: 'srv_identity_route' },
                },
            },
        });

        const onSwitchServerById = vi.fn(async () => {});
        const onAfterSuccess = vi.fn();

        const { useServerAutoAddFromRoute } = await import('./useServerAutoAddFromRoute');

        function Probe() {
            useServerAutoAddFromRoute({
                enabled: true,
                url: 'http://127.0.0.1:3005',
                validateServerReachable: async () => true,
                setError: vi.fn(),
                onSwitchServerById,
                onAfterSuccess,
                source: 'url',
            });
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(adoptHomeProfileMock).toHaveBeenCalledWith(expect.objectContaining({
            descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_identity_route' }),
        }));
        expect(onSwitchServerById).not.toHaveBeenCalled();
        expect(onAfterSuccess).toHaveBeenCalled();
    });
});
