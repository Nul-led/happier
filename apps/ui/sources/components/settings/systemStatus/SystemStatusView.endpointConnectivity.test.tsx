import * as React from 'react';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import type { DoctorSnapshotHomeTransportDiagnostics } from '@happier-dev/protocol';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    standardCleanup();
    serverProfilesState.publicServerUrl = null;
    activeServerSnapshot.carrier = 'https';
    irohDiagnosticsState.values = [{
        homeServerIdentityId: 'home-stable-id',
        state: 'reconnecting',
        lastKnown: { carrier: 'iroh', observedPath: 'relay' },
        effectiveConfiguration: {
            policy: 'automatic',
            relayUrls: ['https://relay.example.test'],
            directAddressCount: 0,
        },
    }];
    irohDiagnosticsState.revision = 0;
    irohDiagnosticsState.listeners.clear();
});

vi.mock('react-native-mmkv', () => {
    class MMKV {
        #store = new Map<string, string>();

        public getString(key: string): string | undefined {
            return this.#store.get(key);
        }

        public set(key: string, value: string): void {
            this.#store.set(key, value);
        }

        public delete(key: string): void {
            this.#store.delete(key);
        }
    }

    return { MMKV };
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                text: '#000000',
                textSecondary: '#777777',
                accent: {
                    indigo: '#0000ff',
                    blue: '#0000ff',
                    orange: '#ff8800',
                    purple: '#9900ff',
                },
            },
        },
    });
});

vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: vi.fn(), back: vi.fn(), replace: vi.fn(), setParams: vi.fn() } }).module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => key,
        translateLoose: (key: string) => key,
    });
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('expo-constants', () => ({
    default: { expoConfig: { version: '0.0.0-test' }, deviceName: 'test-device' },
}));

vi.mock('@/sync/runtime/readCurrentAppRuntimeInfo', () => ({
    readCurrentAppRuntimeInfo: () => ({ appVersion: '0.0.0-test' }),
}));

vi.mock('expo-clipboard', () => ({
    setStringAsync: vi.fn(async () => {}),
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
        eyebrow: () => ({}),
        keyHint: () => ({}),
    },
}));

const activeServerSnapshot = vi.hoisted(() => ({
    generation: 1,
    serverId: 'home-stable-id',
    serverUrl: 'https://legacy.example.test',
    runtimeOrigin: 'http://127.0.0.1:43123',
    carrier: 'https' as 'https' | 'iroh',
}));
const useActiveServerSnapshotMock = vi.hoisted(() => vi.fn(() => activeServerSnapshot));
const serverProfilesState = vi.hoisted(() => ({
    publicServerUrl: null as string | null | undefined,
}));
const irohDiagnosticsState = vi.hoisted(() => ({
    values: [{
        homeServerIdentityId: 'home-stable-id',
        state: 'reconnecting',
        lastKnown: { carrier: 'iroh' as const, observedPath: 'relay' as const },
        effectiveConfiguration: {
            policy: 'automatic' as const,
            relayUrls: ['https://relay.example.test'],
            directAddressCount: 0,
        },
    }] as DoctorSnapshotHomeTransportDiagnostics[],
    revision: 0,
    listeners: new Set<() => void>(),
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: useActiveServerSnapshotMock,
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const { createPartialServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createPartialServerProfilesModuleMock(importOriginal, {
        overrides: {
            listServerProfiles: () => [{
                id: 'local-profile-id',
                serverIdentityId: 'home-stable-id',
                name: 'Personal Home',
                serverUrl: 'https://legacy.example.test',
                canonicalServerUrl: 'https://canonical.example.test',
                publicServerUrl: serverProfilesState.publicServerUrl,
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 1,
            }],
        },
    });
});

vi.mock('@/sync/runtime/irohHomeTransportDiagnostics', () => ({
    readIrohHomeTransportDiagnostics: () => irohDiagnosticsState.values,
    readIrohHomeTransportDiagnosticsRevision: () => irohDiagnosticsState.revision,
    subscribeIrohHomeTransportDiagnostics: (listener: () => void) => {
        irohDiagnosticsState.listeners.add(listener);
        return () => irohDiagnosticsState.listeners.delete(listener);
    },
}));

vi.mock('@/sync/ops/machines', () => ({
    machineCollectBugReportDiagnostics: async () => ({}),
}));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
    useProfile: () => ({ id: 'prof_1', username: 'u1', connectedServices: [] }),
    useIsDataReady: () => true,
    useRealtimeStatus: () => 'connected',
    useSocketStatus: () => ({ status: 'connected', lastError: null, lastErrorAt: null }),
    useEndpointConnectivity: () => ({
            status: 'offline',
            reason: 'server_unreachable',
            attempt: 1,
            nextRetryAt: null,
            lastConnectedAt: null,
            lastDisconnectedAt: Date.now(),
            lastErrorMessage: 'Network request failed',
        }),
    useLastSyncAt: () => null,
    useAllMachines: () => [],
    useMachineListByServerId: () => ({}),
    useMachineListStatusByServerId: () => ({}),
});
});

describe('SystemStatusView (endpoint connectivity)', () => {
    it('subscribes to active Home diagnostics and separates effective carrier from last-known Iroh path', async () => {
        const { SystemStatusView } = await import('./SystemStatusView');
        const screen = await renderScreen(<SystemStatusView />);

        expect(useActiveServerSnapshotMock).toHaveBeenCalled();
        const joined = screen.getTextContent();
        expect(joined).toContain('home-stable-id');
        expect(joined).toContain('https://canonical.example.test');
        expect(joined).toContain('connectionStatus.values.publicIngressAbsent');
        expect(joined).toContain('connectionStatus.labels.effectiveCarrier');
        expect(joined).toContain('HTTPS');
        expect(joined).toContain('Iroh');
        expect(joined).toContain('connectionStatus.labels.lastKnownPath');
        expect(joined).toContain('connectionStatus.values.pathRelay');
        expect(joined).toContain('connectionStatus.labels.relayConfiguration');
        expect(joined).not.toContain('connectionStatus.labels.currentPath');

        irohDiagnosticsState.values = [{
            homeServerIdentityId: 'home-stable-id',
            state: 'connected',
            current: { carrier: 'iroh', observedPath: 'direct' },
            lastKnown: { carrier: 'iroh', observedPath: 'direct' },
        }];
        irohDiagnosticsState.revision += 1;
        await act(async () => {
            for (const listener of irohDiagnosticsState.listeners) listener();
        });

        const updated = screen.getTextContent();
        expect(updated).toContain('connectionStatus.labels.currentPath');
        expect(updated).toContain('connectionStatus.values.pathDirect');
        expect(updated).not.toContain('connectionStatus.labels.lastKnownPath');
    });

    it('keeps unknown public ingress distinct from a Home known to have no public ingress', async () => {
        serverProfilesState.publicServerUrl = undefined;
        const { SystemStatusView } = await import('./SystemStatusView');
        const screen = await renderScreen(<SystemStatusView />);

        const joined = screen.getTextContent();
        expect(joined).toContain('connectionStatus.labels.publicIngress');
        expect(joined).toContain('status.unknown');
        expect(joined).not.toContain('connectionStatus.values.publicIngressAbsent');
    });
});
