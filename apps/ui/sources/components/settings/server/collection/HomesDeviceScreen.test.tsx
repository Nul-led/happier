import * as React from 'react';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { scopedStorageId } from '@/utils/system/storageScope';

const routes = createExpoRouterMock();
vi.mock('expo-router', () => routes.module);
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});
// Authentication, native UI and locale are environment boundaries. Collection,
// controller, profile persistence, group actions and membership controls stay real.
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false, refreshFromActiveServer: async () => {} }),
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

beforeEach(() => {
    vi.resetModules();
    routes.resetParams();
    const scope = `home-group-draft-${crypto.randomUUID()}`;
    vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', scope);
    vi.stubEnv('EXPO_PUBLIC_HAPPY_SERVER_CONTEXT', '');
    const profiles = new MMKV({ id: scopedStorageId('server-profiles', scope) });
    profiles.set('server-state-v1', JSON.stringify({
        activeServerId: 'home-a',
        activeServerIdIsExplicit: true,
        servers: Object.fromEntries(['home-a', 'home-b', 'home-c'].map((id) => [id, {
            id, name: id, serverUrl: `https://${id}.example.test`,
            createdAt: 1, updatedAt: 1, lastUsedAt: 1, source: 'manual',
        }])),
        homeViewStateInitialized: true,
        homeViewState: { version: 1, groups: [], activeTargetKind: 'server', activeTargetId: 'home-a' },
    }));
});

afterEach(() => {
    standardCleanup();
    vi.unstubAllEnvs();
});

async function renderDevice() {
    const { HomesDeviceScreen } = await import('./HomesDeviceScreen');
    const { HomesCollectionProvider } = await import('./HomesCollection');
    return renderScreen(<HomesCollectionProvider><HomesDeviceScreen /></HomesCollectionProvider>);
}

describe('Homes on this device', () => {
    it('does not expose desktop runtime operations on the browser', async () => {
        const screen = await renderDevice();
        expect(screen.findByTestId('settings.localRelayRuntime.status')).toBeNull();
        expect(screen.findByTestId('settings.localTailscale.status')).toBeNull();
        expect(screen.findByTestId('settings.server.personalHomeConsole')).toBeNull();
    });

    it('keeps connection details behind the device disclosure', async () => {
        const screen = await renderDevice();
        expect(screen.findByTestId('connection-status-full-screen')).toBeNull();
        await screen.pressByTestIdAsync('settings.server.connectionDetails.header');
        expect(screen.findByTestId('connection-status-full-screen')).not.toBeNull();
        await screen.pressByTestIdAsync('settings.server.connectionDetails.header');
        expect(screen.findByTestId('connection-status-full-screen')).toBeNull();
    });
});
