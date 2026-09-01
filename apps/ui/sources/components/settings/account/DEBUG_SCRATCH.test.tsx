import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const endpointState = vi.hoisted(() => ({
    endpoint: {
        url: 'https://accounts.example.test',
        displayName: 'Company Account Service',
        source: 'user' as const,
    } as { url: string; serverIdentityId?: string; displayName?: string; source: 'user' },
    set: vi.fn(),
    listeners: new Set<() => void>(),
}));
const refreshMock = vi.hoisted(() => vi.fn());
const enrollMock = vi.hoisted(() => vi.fn());
const probeServerFeaturesAtUrlMock = vi.hoisted(() => vi.fn());
const credentialGetMock = vi.hoisted(() => vi.fn(async () => ({ token: 'directory-token' })));
const getCredentialsMock = vi.hoisted(() => vi.fn(async () => null));
const credentialMutationListeners = vi.hoisted(() => new Set<() => void>());
const session = vi.hoisted(() => ({
    serviceKey: 'https://accounts.example.test\u0000directory-1',
    supportsHomeEnrollment: true,
    snapshot: {
        endpoint: 'https://accounts.example.test',
        status: 'idle',
        homes: [] as Array<Record<string, unknown>>,
        preferredHomeServerIdentityId: null as string | null,
        refreshedAtMs: null as number | null,
        error: null as unknown,
    },
    listeners: new Set<(snapshot: unknown) => void>(),
    subscribe: vi.fn((listener: (snapshot: unknown) => void) => {
        session.listeners.add(listener);
        return () => session.listeners.delete(listener);
    }),
    logout: vi.fn(async () => true),
    setPreferredHome: vi.fn(),
    deleteHome: vi.fn(),
    refresh: vi.fn(),
}));
const createAccountDirectorySessionMock = vi.hoisted(() => vi.fn(() => session));
const pendingEnrollmentState = vi.hoisted(() => ({
    value: null,
    listeners: new Set<() => void>(),
}));
const activePollingState = vi.hoisted(() => ({ callback: null as null | (() => unknown) }));

function publishSessionSnapshot(next: typeof session.snapshot): void {
    session.snapshot = next;
    for (const listener of session.listeners) listener(next);
}

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        getAccountServiceEndpointSnapshot: () => endpointState.endpoint,
        subscribeAccountServiceEndpoint: (listener: () => void) => {
            endpointState.listeners.add(listener);
            return () => endpointState.listeners.delete(listener);
        },
        setAccountServiceEndpoint: (next: typeof endpointState.endpoint) => {
            endpointState.endpoint = next;
            endpointState.set(next);
            for (const listener of endpointState.listeners) listener();
        },
    };
});
vi.mock('@/auth/accountDirectory/accountDirectoryCredentialStorage', () => ({
    accountDirectoryCredentialStorage: { get: credentialGetMock },
    normalizeAccountDirectoryEndpoint: (value: string) => value.trim().replace(/\/+$/, ''),
}));
vi.mock('@/sync/domains/accountDirectory/accountDirectorySession', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/accountDirectory/accountDirectorySession')>();
    return {
        ...actual,
        createAccountDirectorySession: (...args: unknown[]) => createAccountDirectorySessionMock(...args),
    };
});
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: getCredentialsMock,
        clearPendingAccountDirectoryAuth: vi.fn(async () => true),
    },
    subscribeHomeCredentialMutations: (listener: () => void) => {
        credentialMutationListeners.add(listener);
        return () => credentialMutationListeners.delete(listener);
    },
}));
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: probeServerFeaturesAtUrlMock,
}));
vi.mock('@/sync/ops/accountDirectory/refreshAccountHomeDirectory', () => ({
    refreshAccountHomeDirectory: refreshMock,
}));
vi.mock('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome', () => ({
    enrollPreferredDirectoryHome: enrollMock,
    cancelPendingPreferredHomeEnrollment: vi.fn(async () => {}),
    resumePendingPreferredHomeEnrollment: vi.fn(async () => null),
    getPendingPreferredHomeEnrollment: () => pendingEnrollmentState.value,
    subscribePendingPreferredHomeEnrollment: (listener: () => void) => {
        pendingEnrollmentState.listeners.add(listener);
        return () => pendingEnrollmentState.listeners.delete(listener);
    },
}));
vi.mock('@/sync/ops/accountDirectory/useAccountDirectoryActivePolling', async () => {
    const React = await import('react');
    return {
        useAccountDirectoryActivePolling: (callback: () => unknown, enabled = true) => {
            React.useEffect(() => {
                if (!enabled) return;
                activePollingState.callback = callback;
                return () => {
                    if (activePollingState.callback === callback) activePollingState.callback = null;
                };
            }, [callback, enabled]);
        },
    };
});

import { AccountServiceSettingsSection } from './AccountServiceSettingsSection';
import { renderScreen as renderScreenBase } from '@/dev/testkit';

const supportedCapability = {
    version: 1,
    homeDirectory: true,
    homeEnrollment: true,
    homeLoginAssertion: {
        keyId: 'a'.repeat(64),
        publicKeyBase64Url: 'A'.repeat(43),
    },
};

async function renderScreen(...args: Parameters<typeof renderScreenBase>) {
    const screen = await renderScreenBase(...args);
    const advanced = screen.findAll((node) => node.props?.testID === 'settings-account-service-advanced')[0];
    console.log('RENDER: advanced found =', Boolean(advanced));
    if (advanced) act(() => advanced.props.onExpandedChange(true));
    return screen;
}

describe('debug2', () => {
    beforeEach(() => {
        enrollMock.mockReset();
        enrollMock.mockResolvedValue({ kind: 'enrolled', homeServerIdentityId: 'home-b' });
        pendingEnrollmentState.value = null;
        getCredentialsMock.mockReset();
        getCredentialsMock.mockResolvedValue(null);
        probeServerFeaturesAtUrlMock.mockReset();
        probeServerFeaturesAtUrlMock.mockResolvedValue({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    server: { canonicalServerUrl: 'https://canonical-accounts.example.test' },
                    accountDirectory: supportedCapability,
                },
            },
        });
        credentialGetMock.mockResolvedValue({ token: 'directory-token' });
        endpointState.endpoint = {
            url: 'https://accounts.example.test',
            displayName: 'Company Account Service',
            source: 'user',
        };
        endpointState.set.mockClear();
        session.listeners.clear();
        session.serviceKey = 'https://accounts.example.test\u0000directory-1';
        session.supportsHomeEnrollment = true;
        session.subscribe.mockClear();
        session.snapshot = {
            endpoint: 'https://accounts.example.test',
            status: 'idle',
            homes: [],
            preferredHomeServerIdentityId: null,
            refreshedAtMs: null,
            error: null,
        };
        refreshMock.mockReset();
        refreshMock.mockImplementation(async () => {
            publishSessionSnapshot({
                endpoint: 'https://accounts.example.test',
                status: 'ready',
                homes: [
                    {
                        v: 1,
                        homeServerIdentityId: 'home-a',
                        canonicalServerUrl: 'https://home-a.test',
                        label: 'Home A',
                        connectionDescriptor: {
                            v: 1,
                            homeServerIdentityId: 'home-a',
                            canonicalServerUrl: 'https://home-a.test',
                            revision: 1,
                            endpoints: [{ kind: 'https', url: 'https://home-a.test' }],
                        },
                        createdAtMs: 1,
                        updatedAtMs: 1,
                        preferred: false,
                    },
                    {
                        v: 1,
                        homeServerIdentityId: 'home-b',
                        canonicalServerUrl: 'https://home-b.test',
                        label: 'Home B',
                        connectionDescriptor: {
                            v: 1,
                            homeServerIdentityId: 'home-b',
                            canonicalServerUrl: 'https://home-b.test',
                            revision: 1,
                            endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                        },
                        createdAtMs: 1,
                        updatedAtMs: 1,
                        preferred: true,
                    },
                ],
                preferredHomeServerIdentityId: 'home-b',
                refreshedAtMs: 1,
                error: null,
            });
            return session.snapshot;
        });
    });

    it('replicates the failing advanced test', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        const bodyAfterExpand = screen.findAllByTestId('settings-account-service-advanced:body');
        console.log('BODY AFTER EXPAND:', bodyAfterExpand.length);
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        console.log('BODY AFTER REFRESH:', screen.findAllByTestId('settings-account-service-advanced:body').length);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull());

        const select = screen.findByTestId('settings-account-service-select');
        console.log('SELECT:', select?.props?.subtitle, '| advanced expanded:', screen.findAll((node) => node.props?.testID === 'settings-account-service-advanced')[0]?.props?.expanded);
        expect(select?.props?.subtitle).toBe('https://accounts.example.test');
    });
});
