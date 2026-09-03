import * as React from 'react';
import { Linking } from 'react-native';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen as renderScreenBase } from '@/dev/testkit';
import { t } from '@/text';
import type {
    PendingPreferredHomeEnrollment,
    PreferredDirectoryHomeEnrollmentResult,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import type { HomeLoginContinuationResult } from '@/sync/ops/accountDirectory/homeLoginApproval';

const endpointState = vi.hoisted(() => ({
    endpoint: {
        url: 'https://accounts.example.test',
        displayName: 'Company Account Service',
        source: 'user' as const,
    } as {
        url: string;
        serverIdentityId?: string;
        displayName?: string;
        source: 'user';
    },
    set: vi.fn(),
    listeners: new Set<() => void>(),
}));
const credentialGetMock = vi.hoisted(() => vi.fn(
    async (_target?: unknown): Promise<{ token: string } | null> => ({ token: 'directory-token' }),
));
const refreshMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<TestDirectorySessionSnapshot>
>(async () => session.snapshot));
const enrollMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<PreferredDirectoryHomeEnrollmentResult>
>(async () => ({ kind: 'enrolled', homeServerIdentityId: 'home-b' })));
const logoutMock = vi.hoisted(() => vi.fn(async () => true));
const startOAuthMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 'https://oauth.example.test/authorize'));
const loginWithKeyMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ token: 'restricted-directory-token' })));
const probeServerFeaturesAtUrlMock = vi.hoisted(() => vi.fn());
const clearPendingAccountDirectoryAuthMock = vi.hoisted(() => vi.fn(async () => true));
const getCredentialsMock = vi.hoisted(() => vi.fn(async () => null as { token: string } | null));
const credentialMutationListeners = vi.hoisted(() => new Set<() => void>());
const provisionAuthenticatedHomeLinkMock = vi.hoisted(() => vi.fn(
    async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ kind: 'linked', homeServerIdentityId: 'srv_home_a' }),
));
const setPreferredHomeMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ v: 1, preferredHomeServerIdentityId: 'home-b' })));
const deleteHomeMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ v: 1, deleted: true, homeServerIdentityId: 'home-a', preferredHomeServerIdentityId: 'home-b' })));
const sessionRefreshMock = vi.hoisted(() => vi.fn());
type TestDirectorySessionSnapshot = {
    endpoint: string;
    status: string;
    homes: Array<Record<string, unknown>>;
    preferredHomeServerIdentityId: string | null;
    refreshedAtMs: number | null;
    error: unknown;
    reconciliation?: Readonly<{
        kind: 'completed' | 'cancelled';
        adopted: readonly string[];
        failures: readonly Readonly<{
            homeServerIdentityId: string;
            label: string;
            error: unknown;
        }>[];
    }>;
};
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
    } as TestDirectorySessionSnapshot,
    listeners: new Set<(snapshot: unknown) => void>(),
    subscribe: vi.fn((listener: (snapshot: unknown) => void) => {
        session.listeners.add(listener);
        return () => session.listeners.delete(listener);
    }),
    logout: logoutMock,
    setPreferredHome: setPreferredHomeMock,
    deleteHome: deleteHomeMock,
    refresh: sessionRefreshMock,
}));
const createAccountDirectorySessionMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => session));
const cancelPendingPreferredHomeEnrollmentMock = vi.hoisted(() => vi.fn(async () => {}));
const resumePendingPreferredHomeEnrollmentMock = vi.hoisted(() => vi.fn<
    () => Promise<PreferredDirectoryHomeEnrollmentResult | null>
>(async () => null));
const pendingEnrollmentState = vi.hoisted(() => ({
    value: null as PendingPreferredHomeEnrollment | null,
    listeners: new Set<() => void>(),
}));
const activePollingState = vi.hoisted(() => ({
    callback: null as null | (() => unknown | Promise<unknown>),
}));

function publishSessionSnapshot(next: typeof session.snapshot): void {
    session.snapshot = next;
    for (const listener of session.listeners) listener(next);
}

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        getAccountServiceEndpointSnapshot: () => endpointState.endpoint,
        resolveSelectedAccountServiceEndpoint: () => endpointState.endpoint ?? ({
            url: 'https://api.happier.dev', source: 'default' as const,
        }),
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
    accountDirectoryCredentialStorage: { get: credentialGetMock, logout: logoutMock },
    normalizeAccountDirectoryEndpoint: (value: string) => value.trim().replace(/\/+$/, ''),
}));

vi.mock('@/sync/domains/accountDirectory/accountDirectorySession', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/accountDirectory/accountDirectorySession')>();
    return {
        ...actual,
        createAccountDirectorySession: (...args: unknown[]) => createAccountDirectorySessionMock(...args),
    };
});

vi.mock('@/auth/accountDirectory/accountDirectoryAuthClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/accountDirectory/accountDirectoryAuthClient')>();
    return {
        ...actual,
        accountDirectoryAuthClient: {
            discoverAuthenticationMethods: (
                input: Parameters<typeof actual.accountDirectoryAuthClient.discoverAuthenticationMethods>[0],
            ) => actual.accountDirectoryAuthClient.discoverAuthenticationMethods(input),
            startOAuth: (...args: Parameters<typeof actual.accountDirectoryAuthClient.startOAuth>) => startOAuthMock(...args),
            loginWithKey: (...args: Parameters<typeof actual.accountDirectoryAuthClient.loginWithKey>) => loginWithKeyMock(...args),
        },
    };
});

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getCredentialsForServerUrl: getCredentialsMock,
            clearPendingAccountDirectoryAuth: clearPendingAccountDirectoryAuthMock,
        },
        subscribeHomeCredentialMutations: (listener: () => void) => {
            credentialMutationListeners.add(listener);
            return () => credentialMutationListeners.delete(listener);
        },
    };
});

vi.mock('@/sync/ops/accountDirectory/provisionAuthenticatedHomeLink', () => ({
    provisionAuthenticatedHomeLink: provisionAuthenticatedHomeLinkMock,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: probeServerFeaturesAtUrlMock,
}));

vi.mock('@/sync/ops/accountDirectory/refreshAccountHomeDirectory', () => ({
    refreshAccountHomeDirectory: refreshMock,
}));

vi.mock('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome', () => ({
    enrollPreferredDirectoryHome: async (...args: unknown[]) => {
        const result = await enrollMock(...args);
        if (result?.kind === 'approval_required') {
            pendingEnrollmentState.value = {
                ...result,
                serviceKey: (args[0] as { serviceKey?: string })?.serviceKey ?? '',
                entryIntent: (args[1] as { entryIntent?: 'connect_service' | 'enter_preferred_home' })?.entryIntent
                    ?? 'connect_service',
            };
        } else if (result?.kind === 'transport_unavailable' && result.resume && result.cancel) {
            pendingEnrollmentState.value = {
                kind: result.kind,
                reason: result.reason,
                resume: result.resume,
                cancel: result.cancel,
                serviceKey: (args[0] as { serviceKey?: string })?.serviceKey ?? '',
                entryIntent: (args[1] as { entryIntent?: 'connect_service' | 'enter_preferred_home' })?.entryIntent
                    ?? 'connect_service',
                homeServerIdentityId: pendingEnrollmentState.value?.homeServerIdentityId ?? 'home-b',
            };
        } else {
            pendingEnrollmentState.value = null;
        }
        for (const listener of pendingEnrollmentState.listeners) listener();
        return result;
    },
    cancelPendingPreferredHomeEnrollment: async () => {
        await cancelPendingPreferredHomeEnrollmentMock();
        pendingEnrollmentState.value = null;
        for (const listener of pendingEnrollmentState.listeners) listener();
    },
    resumePendingPreferredHomeEnrollment: async () => {
        const result = await resumePendingPreferredHomeEnrollmentMock();
        pendingEnrollmentState.value = result?.kind === 'approval_required'
            || (result?.kind === 'transport_unavailable' && result.resume && result.cancel)
            ? {
                ...result,
                serviceKey: pendingEnrollmentState.value?.serviceKey ?? '',
                entryIntent: pendingEnrollmentState.value?.entryIntent ?? 'connect_service',
                homeServerIdentityId: result.kind === 'approval_required'
                    ? result.homeServerIdentityId
                    : pendingEnrollmentState.value?.homeServerIdentityId ?? 'home-b',
            } as typeof pendingEnrollmentState.value
            : null;
        for (const listener of pendingEnrollmentState.listeners) listener();
        return result;
    },
    getPendingPreferredHomeEnrollment: () => pendingEnrollmentState.value,
    subscribePendingPreferredHomeEnrollment: (listener: () => void) => {
        pendingEnrollmentState.listeners.add(listener);
        return () => pendingEnrollmentState.listeners.delete(listener);
    },
}));
vi.mock('@/sync/ops/accountDirectory/useAccountDirectoryActivePolling', async () => {
    const React = await import('react');
    return {
        useAccountDirectoryActivePolling: (
            callback: () => unknown | Promise<unknown>,
            enabled = true,
        ) => {
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

const promptMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>(
    async () => 'https://new-accounts.example.test',
));
const alertAsyncMock = vi.hoisted(() => vi.fn(async () => {}));
const confirmMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { prompt: promptMock, alertAsync: alertAsyncMock, confirm: confirmMock } }).module;
});

import { AccountServiceSettingsSection } from './AccountServiceSettingsSection';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';

async function renderScreen(...args: Parameters<typeof renderScreenBase>) {
    const screen = await renderScreenBase(...args);
    const advanced = screen.findAll((node) => node.props?.testID === 'settings-account-service-advanced')[0];
    if (advanced) act(() => advanced.props.onExpandedChange(true));
    return screen;
}

async function waitForAutomaticHydration(
    screen: Awaited<ReturnType<typeof renderScreen>>,
): Promise<void> {
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());
}

function clearAutomaticHydrationCalls(): void {
    refreshMock.mockClear();
    enrollMock.mockClear();
    createAccountDirectorySessionMock.mockClear();
    sessionRefreshMock.mockClear();
    endpointState.set.mockClear();
    probeServerFeaturesAtUrlMock.mockClear();
}

describe('AccountServiceSettingsSection', () => {
    const supportedCapability = {
        version: 1,
        homeDirectory: true,
        homeEnrollment: true,
        homeLoginAssertion: {
            keyId: 'a'.repeat(64),
            publicKeyBase64Url: 'A'.repeat(43),
        },
    };

    beforeEach(() => {
        credentialGetMock.mockClear();
        refreshMock.mockClear();
        enrollMock.mockReset();
        enrollMock.mockResolvedValue({ kind: 'enrolled', homeServerIdentityId: 'home-b' });
        cancelPendingPreferredHomeEnrollmentMock.mockClear();
        resumePendingPreferredHomeEnrollmentMock.mockReset();
        resumePendingPreferredHomeEnrollmentMock.mockResolvedValue(null);
        pendingEnrollmentState.value = null;
        pendingEnrollmentState.listeners.clear();
        activePollingState.callback = null;
        credentialMutationListeners.clear();
        logoutMock.mockClear();
        createAccountDirectorySessionMock.mockClear();
        startOAuthMock.mockClear();
        startOAuthMock.mockResolvedValue('https://oauth.example.test/authorize');
        loginWithKeyMock.mockClear();
        loginWithKeyMock.mockResolvedValue({ token: 'restricted-directory-token' });
        clearPendingAccountDirectoryAuthMock.mockClear();
        getCredentialsMock.mockReset();
        getCredentialsMock.mockResolvedValue(null);
        provisionAuthenticatedHomeLinkMock.mockClear();
        provisionAuthenticatedHomeLinkMock.mockResolvedValue({ kind: 'linked', homeServerIdentityId: 'srv_home_a' });
        probeServerFeaturesAtUrlMock.mockReset();
        probeServerFeaturesAtUrlMock.mockResolvedValue({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    server: {
                        canonicalServerUrl: 'https://canonical-accounts.example.test',
                    },
                    accountDirectory: supportedCapability,
                    oauth: {
                        providers: {
                            oidc: { configured: false },
                            okta: { configured: true, enabled: true },
                            github: { configured: true, enabled: true },
                        },
                    },
                    auth: {
                        keyChallenge: { v2: true },
                        methods: [
                            {
                                id: 'oidc',
                                actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                            },
                            {
                                id: 'okta',
                                actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                            },
                            {
                                id: 'github',
                                actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                            },
                        ],
                    },
                },
            },
        });
        credentialGetMock.mockResolvedValue({ token: 'directory-token' });
        endpointState.endpoint = {
            url: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
            displayName: 'Company Account Service',
            source: 'user',
        };
        endpointState.set.mockClear();
        promptMock.mockReset();
        promptMock.mockResolvedValue('https://new-accounts.example.test');
        alertAsyncMock.mockClear();
        confirmMock.mockReset();
        confirmMock.mockResolvedValue(true);
        setPreferredHomeMock.mockReset();
        setPreferredHomeMock.mockResolvedValue({ v: 1, preferredHomeServerIdentityId: 'home-b' });
        deleteHomeMock.mockReset();
        deleteHomeMock.mockResolvedValue({
            v: 1,
            deleted: true,
            homeServerIdentityId: 'home-a',
            preferredHomeServerIdentityId: 'home-b',
        });
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
        sessionRefreshMock.mockReset();
        sessionRefreshMock.mockImplementation(async () => session.snapshot);
    });

    it('shows credential checking on the initial frame instead of disconnected', async () => {
        let resolveCredentials: ((value: { token: string } | null) => void) | null = null;
        credentialGetMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCredentials = resolve;
        }));

        const screen = await renderScreen(<AccountServiceSettingsSection />);

        expect(screen.findAllByTestId('settings-account-service-status').find((node) => node.props.detail)?.props.detail)
            .toBe(t('settingsAccount.accountServiceCheckingConnection'));
        expect(screen.findByTestId('settings-account-service-login')).toBeNull();

        await act(async () => resolveCredentials?.({ token: 'directory-token' }));
        expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull();
    });

    it('shows secure custody unavailable instead of disconnected when credential loading fails', async () => {
        credentialGetMock.mockRejectedValueOnce(new Error('secure storage unavailable'));

        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await vi.waitFor(() => {
            expect(screen.findAllByTestId('settings-account-service-status').find((node) => node.props.detail)?.props.detail)
                .toBe(t('common.unavailable'));
        });
        expect(screen.findByTestId('settings-account-service-login')).toBeNull();
    });

    it('automatically probes and hydrates the canonical Directory session after connected mount', async () => {
        endpointState.endpoint = {
            url: 'https://accounts.example.test',
            displayName: 'Company Account Service',
            source: 'user',
        };
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());
        expect(credentialGetMock).toHaveBeenCalledWith({
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
        });
        expect(endpointState.set).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
        }));
        expect(createAccountDirectorySessionMock).toHaveBeenCalledOnce();
        expect(enrollMock).toHaveBeenCalledOnce();
    });

    it('projects one reconciliation failure on its Home row while preserving later successful Homes', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull());
        act(() => publishSessionSnapshot({
            ...session.snapshot,
            reconciliation: {
                kind: 'completed',
                adopted: ['home-b'],
                failures: [{
                    homeServerIdentityId: 'home-a',
                    label: 'Home A',
                    error: new Error('identity conflict'),
                }],
            },
        }));
        expect(screen.findAllByTestId('settings-account-service-home-home-a')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t('settingsAccount.accountServiceHomeConnectionFailed'));
        expect(screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail ?? '')
            .not.toContain(t('settingsAccount.accountServiceHomeConnectionFailed'));
    });

    it('keeps an OAuth-created pending approval across settings remount without resuming it in the refresh cadence', async () => {
        pendingEnrollmentState.value = {
            kind: 'approval_required',
            serviceKey: 'https://accounts.example.test\u0000directory-1',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'home-b',
            approvalId: 'approval-home-b',
            expiresAtMs: Date.now() + 60_000,
            resume: vi.fn(async () => ({ kind: 'approval_required' })),
            cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
        } as typeof pendingEnrollmentState.value;
        endpointState.endpoint = {
            ...endpointState.endpoint,
            serverIdentityId: 'directory-1',
        };

        const first = await renderScreen(<AccountServiceSettingsSection />);
        expect(activePollingState.callback).toBeNull();
        act(() => first.tree.unmount());
        expect(cancelPendingPreferredHomeEnrollmentMock).not.toHaveBeenCalled();

        const second = await renderScreen(<AccountServiceSettingsSection />);
        expect(activePollingState.callback).toBeNull();
        expect(resumePendingPreferredHomeEnrollmentMock).not.toHaveBeenCalled();
        expect(second.findByTestId('settings-account-service-home-home-b-enroll')).not.toBeNull();
        expect(cancelPendingPreferredHomeEnrollmentMock).not.toHaveBeenCalled();
        act(() => second.tree.unmount());
    });

    it('keeps Directory Homes ready and skips preferred enrollment when only Home enrollment is unsupported', async () => {
        session.supportsHomeEnrollment = false;
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    accountDirectory: { ...supportedCapability, homeEnrollment: false },
                },
            },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());
        expect(enrollMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-service-directory-unsupported')).toBeNull();
    });

    it('uses a product-facing endpoint name for the primary group when no display name is stored', async () => {
        endpointState.endpoint = {
            url: 'https://accounts.example.test',
            source: 'user',
        };

        const screen = await renderScreen(<AccountServiceSettingsSection />);

        expect(screen.findAll((node) => node.props?.title === 'accounts.example.test').length).toBeGreaterThan(0);
        expect(screen.findAll((node) => node.props?.title === 'https://accounts.example.test')).toHaveLength(0);
    });

    it('hides the old service projection synchronously when the endpoint identity changes', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());

        let resolveCredentials: ((value: { token: string } | null) => void) | null = null;
        credentialGetMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCredentials = resolve;
        }));
        await act(async () => {
            endpointState.endpoint = {
                url: 'https://accounts.example.test',
                serverIdentityId: 'directory-2',
                displayName: 'Replacement Account Service',
                source: 'user',
            };
            for (const listener of endpointState.listeners) listener();
            await Promise.resolve();
        });

        expect(screen.findByTestId('settings-account-service-home-home-a')).toBeNull();
        expect(screen.findAllByTestId('settings-account-service-status').find((node) => node.props.detail)?.props.detail)
            .toBe(t('settingsAccount.accountServiceCheckingConnection'));

        await act(async () => resolveCredentials?.(null));
    });

    it('preserves the current service Homes when endpoint selection is cancelled', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());
        expect(screen.findByTestId('settings-account-service-home-home-b-preferred')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-b-preferred')).not.toBeNull();
        endpointState.set.mockClear();
        promptMock.mockResolvedValueOnce(null);

        await screen.pressByTestIdAsync('settings-account-service-select');

        expect(endpointState.set).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-b-preferred')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-b-preferred')).not.toBeNull();
    });

    it('keeps same-service Homes visible during refresh and localizes pending state to that work', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());

        let resolveRefresh: ((value: typeof session.snapshot) => void) | null = null;
        refreshMock.mockImplementationOnce(() => {
            publishSessionSnapshot({ ...session.snapshot, status: 'loading', error: null });
            return new Promise((resolve) => {
                resolveRefresh = resolve;
            });
        });
        const refreshPress = screen.pressByTestIdAsync('settings-account-service-refresh');

        await vi.waitFor(() => expect(screen.findAllByTestId('settings-account-service-refresh').some((node) => node.props.loading === true)).toBe(true));
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-disconnect')?.props.disabled).not.toBe(true);

        await act(async () => resolveRefresh?.(session.snapshot));
        await refreshPress;
        expect(createAccountDirectorySessionMock).toHaveBeenCalledOnce();
    });

    it('renders loading and stale-error state directly from the bound session while preserving its Homes', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());

        act(() => publishSessionSnapshot({
            ...session.snapshot,
            status: 'loading',
            error: null,
        }));

        expect(screen.findAllByTestId('settings-account-service-refresh').some((node) => node.props.loading === true)).toBe(true);
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();

        act(() => publishSessionSnapshot({
            ...session.snapshot,
            status: 'stale',
            error: new Error('offline'),
        }));

        expect(screen.findByTestId('settings-account-service-directory-unavailable')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
    });

    it('uses row-local pending state so another Home action remains available', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a-set-preferred')).not.toBeNull());

        let resolvePreferred: (() => void) | null = null;
        setPreferredHomeMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolvePreferred = () => resolve({ v: 1, preferredHomeServerIdentityId: 'home-a' });
        }));
        const preferredPress = screen.pressByTestIdAsync('settings-account-service-home-home-a-set-preferred');

        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a-set-preferred')?.props.disabled).toBe(true));
        expect(screen.findByTestId('settings-account-service-home-home-b-remove')?.props.disabled).not.toBe(true);

        await act(async () => resolvePreferred?.());
        await preferredPress;
    });

    it('distinguishes unsupported discovery, an empty directory, and refresh failure', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);

        act(() => publishSessionSnapshot({
            ...session.snapshot,
            status: 'unsupported',
        }));
        expect(screen.findByTestId('settings-account-service-directory-unsupported')).not.toBeNull();

        act(() => publishSessionSnapshot({
            ...session.snapshot,
            status: 'ready',
            homes: [],
            preferredHomeServerIdentityId: null,
        }));
        expect(screen.findByTestId('settings-account-service-directory-empty')).not.toBeNull();

        act(() => publishSessionSnapshot({
            ...session.snapshot,
            status: 'stale',
            homes: [{
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
                preferred: true,
            }],
            preferredHomeServerIdentityId: 'home-a',
            error: new Error('offline'),
        }));
        expect(screen.findByTestId('settings-account-service-directory-unavailable')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
    });

    it('offers reconnection when the Account Service credential has expired', async () => {
        const expired = Object.assign(new Error('expired'), { status: 401 });
        refreshMock.mockImplementationOnce(async () => {
            publishSessionSnapshot({
                ...session.snapshot,
                status: 'error',
                error: expired,
            });
            return session.snapshot;
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await vi.waitFor(() => {
            expect(screen.findByTestId('settings-account-service-directory-credential-expired')).not.toBeNull();
            expect(screen.findByTestId('settings-account-service-login')).not.toBeNull();
        });
    });

    it('keeps Home identity secondary and exposes explicit preferred status and action text', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull());

        const preferred = screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => node.props.title === 'Home B');
        expect(preferred?.props.title).toBe('Home B');
        expect(preferred?.props.subtitle).toBeUndefined();
        expect(preferred?.props.accessibilityLabel).toContain(t('settingsAccount.accountServicePreferredHome'));
        expect(preferred?.props.rightElement).toBeTruthy();
        expect(screen.getTextContent()).toContain(t('settingsAccount.accountServiceDiscoveryDescription'));
    });

    it('keeps at most one common Home action inline and moves destructive actions to overflow', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());

        const actions = screen.findAllByType(ItemRowActions)
            .find((node) => node.props.title === 'Home A');
        expect(actions?.props.compactThreshold).toBe(Number.MAX_SAFE_INTEGER);
        expect(actions?.props.compactActionIds).toHaveLength(1);
        expect(actions?.props.compactActionIds).not.toContain('settings-account-service-home-home-a-remove');
        expect(actions?.props.actions.some((action: { id: string; destructive?: boolean }) => (
            action.id === 'settings-account-service-home-home-a-remove' && action.destructive === true
        ))).toBe(true);
    });

    it('uses the product hierarchy routinely and keeps exact service, capability, and diagnostics facts in Advanced', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);

        expect(screen.getTextContent()).toContain(t('settingsAccount.accountHomeDiscoveryTitle'));
        expect(screen.findAllByTestId('settings-account-service-status')
            .some((node) => node.props.title === 'Company Account Service')).toBe(true);
        const endpointDetails = screen.findAllByTestId('settings-account-service-select')
            .find((node) => node.props.subtitle === 'https://accounts.example.test');
        expect(endpointDetails?.props.title).toBe(t('settingsAccount.accountServiceSignInService'));
        expect(endpointDetails?.props.subtitle)
            .toBe('https://accounts.example.test');
        expect(screen.findAllByTestId('settings-account-service-technical-identity')
            .some((node) => node.props.detail === 'directory-1')).toBe(true);
        expect(screen.findAllByTestId('settings-account-service-technical-home-directory')
            .some((node) => node.props.detail === t('common.yes'))).toBe(true);
        expect(screen.findAllByTestId('settings-account-service-technical-home-enrollment')
            .some((node) => node.props.detail === t('common.yes'))).toBe(true);
        expect(screen.findAllByTestId('settings-account-service-technical-diagnostics')
            .some((node) => node.props.detail === t('settingsAccount.accountServiceDiagnosticReady'))).toBe(true);
        expect(screen.findAllByTestId('settings-account-service-technical-last-refresh')
            .some((node) => Boolean(node.props.detail))).toBe(true);
        expect(screen.findAllByTestId('settings-account-service-technical-preferred')
            .some((node) => node.props.detail === 'Home B')).toBe(true);
        expect(screen.findByTestId('settings-account-service-home-home-b')?.props.subtitle).toBeUndefined();
        expect(screen.findAllByTestId('settings-account-service-technical-home-home-b')
            .some((node) => typeof node.props.subtitle === 'string'
                && node.props.subtitle.includes('https://home-b.test'))).toBe(true);
    });

    it('renders local Link actions and Directory state in one coherent Homes surface', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        profiles.upsertServerProfile({
            serverUrl: 'https://coherent-home.example.test',
            name: 'Coherent Home',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://coherent-home.example.test', 'srv_coherent_home');
        getCredentialsMock.mockResolvedValue({ token: 'home-a-token' });
        for (const listener of credentialMutationListeners) listener();
        refreshMock.mockImplementationOnce(async () => {
            publishSessionSnapshot({
                ...session.snapshot,
                status: 'ready',
                homes: [{
                    v: 1,
                    homeServerIdentityId: 'srv_coherent_home',
                    canonicalServerUrl: 'https://coherent-home.example.test',
                    label: 'Coherent Home',
                    connectionDescriptor: {
                        v: 1,
                        homeServerIdentityId: 'srv_coherent_home',
                        canonicalServerUrl: 'https://coherent-home.example.test',
                        revision: 1,
                        endpoints: [{ kind: 'https', url: 'https://coherent-home.example.test' }],
                    },
                    createdAtMs: 1,
                    updatedAtMs: 1,
                    preferred: true,
                }],
                preferredHomeServerIdentityId: 'srv_coherent_home',
            });
            return session.snapshot;
        });

        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-srv_coherent_home')).not.toBeNull());

        expect(screen.findByTestId('settings-account-service-home-srv_coherent_home-link')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-local-home-srv_coherent_home')).toBeNull();
    });

    it('fails closed before restricted OAuth when Account Directory capability is missing', async () => {
        credentialGetMock.mockResolvedValueOnce(null);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    oauth: { providers: { okta: { configured: true, enabled: true } } },
                    auth: {
                        methods: [{
                            id: 'okta',
                            actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                        }],
                    },
                },
            },
        });
        const openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-login');

        expect(probeServerFeaturesAtUrlMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts.example.test',
            force: true,
        });
        expect(endpointState.set).not.toHaveBeenCalled();
        expect(startOAuthMock).not.toHaveBeenCalled();
        expect(openUrl).not.toHaveBeenCalled();
        expect(createAccountDirectorySessionMock).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalled();
        openUrl.mockRestore();
    });

    it('starts restricted Account Service OAuth at the selected explicit endpoint when capability is present', async () => {
        credentialGetMock.mockResolvedValueOnce(null);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    server: { canonicalServerUrl: 'https://accounts.example.test' },
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true, enabled: true } } },
                    auth: {
                        methods: [{
                            id: 'okta',
                            actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                        }],
                    },
                },
            },
        });
        const openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-login');

        expect(startOAuthMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            canonicalServerUrl: 'https://accounts.example.test',
            providerId: 'okta',
            mode: 'keyless',
            entryIntent: 'connect_service',
            returnTo: '/settings/account',
        });
        expect(openUrl).toHaveBeenCalledWith('https://oauth.example.test/authorize');
        openUrl.mockRestore();
    });

    it('logs in with a secret key through the restricted target and discovers Homes without changing focus', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://focused-home.example.test',
            name: 'Focused Home',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://focused-home.example.test', 'srv_focused_home');
        profiles.setActiveServerId(focused.id);
        const focusedServerId = profiles.getActiveServerSnapshot().serverId;
        credentialGetMock.mockResolvedValueOnce(null);
        promptMock.mockResolvedValueOnce('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        const openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-key-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-key-login');

        expect(probeServerFeaturesAtUrlMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts.example.test',
            force: true,
        });
        expect(promptMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.objectContaining({ inputType: 'secure-text' }),
        );
        expect(loginWithKeyMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            canonicalServerUrl: 'https://canonical-accounts.example.test',
            secret: expect.any(Uint8Array),
        });
        const loginInput = loginWithKeyMock.mock.calls[0]?.[0] as { secret: Uint8Array } | undefined;
        const secret = loginInput?.secret;
        expect(secret).toHaveLength(32);
        expect(endpointState.set).toHaveBeenCalledWith(expect.objectContaining({
            serverIdentityId: 'directory-1',
        }));
        expect(createAccountDirectorySessionMock).toHaveBeenCalledWith(
            {
                endpoint: 'https://accounts.example.test',
                serverIdentityId: 'directory-1',
            },
            { capability: supportedCapability },
        );
        expect(refreshMock).toHaveBeenCalledWith(session, expect.objectContaining({
            entryIntent: 'connect_service',
            shouldCancel: expect.any(Function),
        }));
        expect(enrollMock).toHaveBeenCalledWith(session, expect.objectContaining({
            entryIntent: 'connect_service',
            shouldCancel: expect.any(Function),
        }));
        expect(startOAuthMock).not.toHaveBeenCalled();
        expect(openUrl).not.toHaveBeenCalled();
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedServerId);
        openUrl.mockRestore();
    });

    it('projects the same Home approval result after key login as refresh enrollment', async () => {
        credentialGetMock.mockResolvedValueOnce(null);
        promptMock.mockResolvedValueOnce('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        enrollMock.mockResolvedValueOnce({
            kind: 'approval_required',
            homeServerIdentityId: 'home-b',
            approvalId: 'approval-home-b',
            expiresAtMs: Date.now() + 60_000,
            resume: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
            cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-key-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-key-login');

        await vi.waitFor(() => expect(
            screen.findAllByTestId('settings-account-service-home-home-b')
                .find((node) => typeof node.props.detail === 'string')?.props.detail,
        ).toContain(t('settingsAccount.accountServiceHomeApprovalRequired')));
    });

    it('resumes key-login enrollment only after the user invokes the retained Home retry action', async () => {
        credentialGetMock.mockResolvedValueOnce(null);
        promptMock.mockResolvedValueOnce('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        enrollMock.mockResolvedValueOnce({
            kind: 'approval_required',
            homeServerIdentityId: 'home-b',
            approvalId: 'approval-home-b',
            expiresAtMs: Date.now() + 60_000,
            resume: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'enrolled', homeServerIdentityId: 'home-b' })),
            cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
        });
        resumePendingPreferredHomeEnrollmentMock.mockResolvedValueOnce({
            kind: 'enrolled',
            homeServerIdentityId: 'home-b',
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-key-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-key-login');
        expect(activePollingState.callback).toBeNull();
        expect(resumePendingPreferredHomeEnrollmentMock).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('settings-account-service-home-home-b-enroll');
        expect(resumePendingPreferredHomeEnrollmentMock).toHaveBeenCalledOnce();
        expect(screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail ?? '')
            .not.toContain(t('settingsAccount.accountServiceHomeApprovalRequired'));
        expect(screen.findByTestId('settings.server.homeEnrollment.pending.retry')).toBeNull();
    });

    it('projects a failed row when an explicit pending Home retry rejects', async () => {
        endpointState.endpoint = {
            ...endpointState.endpoint,
            serverIdentityId: 'directory-1',
        };
        pendingEnrollmentState.value = {
            kind: 'approval_required',
            serviceKey: 'https://accounts.example.test\u0000directory-1',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'home-b',
            approvalId: 'approval-home-b',
            expiresAtMs: Date.now() + 60_000,
            resume: vi.fn(async () => ({ kind: 'approval_required' })),
            cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
        } as typeof pendingEnrollmentState.value;
        resumePendingPreferredHomeEnrollmentMock.mockRejectedValueOnce(new Error('transport unavailable'));

        const screen = await renderScreen(<AccountServiceSettingsSection />);
        expect(activePollingState.callback).toBeNull();
        expect(resumePendingPreferredHomeEnrollmentMock).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('settings-account-service-home-home-b-enroll');
        expect(screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t('settingsAccount.accountServiceHomeConnectionFailed'));
    });

    it.each([
        ['rejected', 'connect.pairingRejectedBody', 'settingsAccount.accountServiceConnectHome'],
        ['expired', 'settingsAccount.accountServiceOAuth.errors.expired.body', 'settingsAccount.accountServiceConnectHome'],
        ['failed', 'settingsAccount.accountServiceHomeConnectionFailed', 'settingsAccount.accountServiceRetryHomeConnection'],
        ['partial_commit', 'connect.homeEnrollmentPartialCommitBody', 'settingsAccount.accountServiceRetryHomeConnection'],
    ] as const)(
        'projects a retained approval continuation that resolves %s without collapsing its presentation',
        async (kind, translationKey, recoveryTranslationKey) => {
            pendingEnrollmentState.value = {
                kind: 'approval_required',
                serviceKey: 'https://accounts.example.test\u0000directory-1',
                entryIntent: 'connect_service',
                homeServerIdentityId: 'home-b',
                approvalId: 'approval-home-b',
                expiresAtMs: Date.now() + 60_000,
                resume: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
                cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
            };
            resumePendingPreferredHomeEnrollmentMock.mockResolvedValueOnce(
                kind === 'partial_commit'
                    ? {
                        kind,
                        homeServerIdentityId: 'home-b',
                        canonicalServerUrl: 'https://home-b.example.test',
                        adoptionError: new Error('profile adoption failed'),
                        rollbackOutcome: { kind: 'not_applied', reason: 'ownership_changed' },
                    }
                    : { kind },
            );
            const screen = await renderScreen(<AccountServiceSettingsSection />);
            expect(activePollingState.callback).toBeNull();

            expect(resumePendingPreferredHomeEnrollmentMock).not.toHaveBeenCalled();
            await screen.pressByTestIdAsync('settings-account-service-home-home-b-enroll');
            expect(screen.findAllByTestId('settings-account-service-home-home-b')
                .find((node) => typeof node.props.detail === 'string')?.props.detail)
                .toContain(t(translationKey));
            expect(screen.findByTestId('settings-account-service-home-home-b-enroll')?.props.accessibilityLabel)
                .toBe(t(recoveryTranslationKey));
            expect(resumePendingPreferredHomeEnrollmentMock).toHaveBeenCalledOnce();
        },
    );

    it.each(['failed', 'cancelled', 'rejected'] as const)(
        'does not project an explicit continuation that resolves %s after disconnect into the next connection',
        async (outcome) => {
            credentialGetMock.mockResolvedValueOnce(null);
            promptMock
                .mockResolvedValueOnce('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
                .mockResolvedValueOnce('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
            enrollMock.mockResolvedValueOnce({
                kind: 'approval_required',
                homeServerIdentityId: 'home-b',
                approvalId: 'approval-home-b',
                expiresAtMs: Date.now() + 60_000,
                resume: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
                cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
            });
            let settleResume: (() => void) | null = null;
            resumePendingPreferredHomeEnrollmentMock.mockImplementationOnce(() => new Promise((resolve, reject) => {
                settleResume = () => {
                    if (outcome === 'rejected') reject(new Error('late rejection'));
                    else resolve({ kind: outcome, ...(outcome === 'failed' ? { error: new Error('late failure') } : {}) });
                };
            }));
            const screen = await renderScreen(<AccountServiceSettingsSection />);
            await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-key-login')).not.toBeNull());

            await screen.pressByTestIdAsync('settings-account-service-key-login');
            expect(activePollingState.callback).toBeNull();
            act(() => {
                screen.findByTestId('settings-account-service-home-home-b-enroll')?.props.onPress();
            });
            await vi.waitFor(() => expect(resumePendingPreferredHomeEnrollmentMock).toHaveBeenCalledOnce());

            await screen.pressByTestIdAsync('settings-account-service-disconnect');
            await act(async () => settleResume?.());
            await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-key-login')).not.toBeNull());
            await screen.pressByTestIdAsync('settings-account-service-key-login');

            await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull());
            expect(screen.findAllByTestId('settings-account-service-home-home-b')
                .find((node) => typeof node.props.detail === 'string')?.props.detail ?? '')
                .not.toContain(t('settingsAccount.accountServiceHomeConnectionFailed'));
        },
    );

    it('captures explicit Link-this-Home intent into OAuth without inferring it from focus', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        credentialGetMock.mockResolvedValueOnce(null);
        getCredentialsMock.mockResolvedValue({ token: 'home-a-token' });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    server: { canonicalServerUrl: 'https://accounts.example.test' },
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true, enabled: true } } },
                    auth: {
                        methods: [{
                            id: 'okta',
                            actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                        }],
                    },
                },
            },
        });
        const openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(
            screen.findByTestId('settings-account-service-local-home-srv_home_a-link'),
        ).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-local-home-srv_home_a-link');

        expect(startOAuthMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            homeServerIdentityId: 'srv_home_a',
        }));
        expect(getCredentialsMock).toHaveBeenCalledWith(
            'https://home-a.test',
            expect.objectContaining({ serverId: expect.any(String) }),
        );
        const startInput = startOAuthMock.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(startInput).not.toHaveProperty('credentials');
        expect(startInput).not.toHaveProperty('connectionDescriptor');
        expect(screen.findAllByType(ItemRowActions)
            .find((node) => node.props.title === 'Home A')
            ?.props.actions.some((action: { title: string }) => (
                action.title === 'Make this Home available on your other devices'
            ))).toBe(true);
        expect(provisionAuthenticatedHomeLinkMock).not.toHaveBeenCalled();
        openUrl.mockRestore();
    });

    it('keeps the explicit self-link bound to the captured Home when focus changes during service verification', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const homeA = profiles.upsertServerProfile({
            serverUrl: 'https://captured-home.test',
            name: 'Captured Home',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://captured-home.test', 'srv_captured_home');
        const homeB = profiles.upsertServerProfile({
            serverUrl: 'https://later-focused-home.test',
            name: 'Later Focused Home',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://later-focused-home.test', 'srv_later_focused_home');
        profiles.setActiveServerId(homeA.id);
        getCredentialsMock.mockResolvedValue({ token: 'captured-home-token' });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        let resolveProbe: ((value: unknown) => void) | null = null;
        probeServerFeaturesAtUrlMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveProbe = resolve;
        }));

        const actions = screen.findAllByType(ItemRowActions)
            .find((node) => node.props.title === 'Captured Home')
            ?.props.actions as Array<{ id: string; onPress: () => void }> | undefined;
        const link = actions?.find((action) => (
            action.id === 'settings-account-service-local-home-srv_captured_home-link'
        ));
        expect(link).toBeDefined();
        act(() => link?.onPress());
        await vi.waitFor(() => expect(probeServerFeaturesAtUrlMock).toHaveBeenCalledOnce());
        act(() => profiles.setActiveServerId(homeB.id));
        await act(async () => {
            resolveProbe?.({
                status: 'ready',
                serverIdentityId: 'directory-1',
                features: { capabilities: { accountDirectory: supportedCapability } },
            });
            await vi.waitFor(() => expect(provisionAuthenticatedHomeLinkMock).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(enrollMock).toHaveBeenCalledOnce());
        });

        expect(provisionAuthenticatedHomeLinkMock).toHaveBeenCalledWith(expect.objectContaining({
            homeServerIdentityId: 'srv_captured_home',
            issuerServerIdentityId: 'directory-1',
        }));
        expect(profiles.getActiveServerSnapshot().serverId).toBe('srv_later_focused_home');
    });

    it('fails closed instead of retargeting self-link when verification observes another service identity', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({
            serverUrl: 'https://captured-home.test',
            name: 'Captured Home',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://captured-home.test', 'srv_captured_home');
        profiles.setActiveServerId(home.id);
        getCredentialsMock.mockResolvedValue({ token: 'captured-home-token' });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-other',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });

        await screen.pressByTestIdAsync('settings-account-service-local-home-srv_captured_home-link');

        expect(provisionAuthenticatedHomeLinkMock).not.toHaveBeenCalled();
        expect(endpointState.set).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalled();
    });

    it('keeps ordinary Refresh read-only while refreshing and enrolling an already-linked preferred Home', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        getCredentialsMock.mockResolvedValue({ token: 'home-a-token' });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();

        await screen.pressByTestIdAsync('settings-account-service-refresh');

        expect(createAccountDirectorySessionMock).not.toHaveBeenCalled();
        expect(provisionAuthenticatedHomeLinkMock).not.toHaveBeenCalled();
        expect(refreshMock).toHaveBeenCalledWith(session, expect.objectContaining({
            shouldCancel: expect.any(Function),
        }));
        expect(enrollMock).toHaveBeenCalledWith(session, expect.objectContaining({
            shouldCancel: expect.any(Function),
        }));
    });

    it('confirms an exact signing-key conflict from the explicit Home Link action', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        getCredentialsMock.mockResolvedValue({ token: 'home-a-token' });
        provisionAuthenticatedHomeLinkMock
            .mockResolvedValueOnce({ kind: 'relink_required', homeServerIdentityId: 'srv_home_a' })
            .mockResolvedValueOnce({ kind: 'linked', homeServerIdentityId: 'srv_home_a' });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        await vi.waitFor(() => expect(
            screen.findByTestId('settings-account-service-local-home-srv_home_a-link'),
        ).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-local-home-srv_home_a-link');

        await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledOnce());
        expect(provisionAuthenticatedHomeLinkMock).toHaveBeenCalledTimes(2);
        expect(provisionAuthenticatedHomeLinkMock.mock.calls[0]?.[0]).not.toHaveProperty('relink', true);
        expect(provisionAuthenticatedHomeLinkMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            session,
            homeServerIdentityId: 'srv_home_a',
            issuerServerIdentityId: 'directory-1',
            capability: supportedCapability,
            relink: true,
        }));
        expect(refreshMock).toHaveBeenCalledWith(session, expect.objectContaining({
            shouldCancel: expect.any(Function),
        }));
        expect(enrollMock).toHaveBeenCalledWith(session, expect.objectContaining({
            shouldCancel: expect.any(Function),
        }));
    });

    it('keeps the pinned Home trust unchanged when explicit re-link confirmation is declined', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        getCredentialsMock.mockResolvedValue({ token: 'home-a-token' });
        provisionAuthenticatedHomeLinkMock.mockResolvedValueOnce({
            kind: 'relink_required',
            homeServerIdentityId: 'srv_home_a',
        });
        confirmMock.mockResolvedValueOnce(false);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        await vi.waitFor(() => expect(
            screen.findByTestId('settings-account-service-local-home-srv_home_a-link'),
        ).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-local-home-srv_home_a-link');

        await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledOnce());
        expect(provisionAuthenticatedHomeLinkMock).toHaveBeenCalledOnce();
        expect(refreshMock).not.toHaveBeenCalled();
        expect(enrollMock).not.toHaveBeenCalled();
        expect(alertAsyncMock).not.toHaveBeenCalled();
    });

    it('stops and reports failure when the authenticated Home relationship retry cannot be provisioned', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        getCredentialsMock.mockResolvedValue({ token: 'home-a-token' });
        provisionAuthenticatedHomeLinkMock.mockResolvedValueOnce({
            kind: 'unavailable',
            reason: 'home_transport_unavailable',
        });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        await vi.waitFor(() => expect(
            screen.findByTestId('settings-account-service-local-home-srv_home_a-link'),
        ).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-local-home-srv_home_a-link');

        await vi.waitFor(() => expect(alertAsyncMock).toHaveBeenCalledOnce());
        expect(provisionAuthenticatedHomeLinkMock).toHaveBeenCalledOnce();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(refreshMock).not.toHaveBeenCalled();
        expect(enrollMock).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalledWith(t('common.error'), t('errors.operationFailed'));
    });

    it('fails closed instead of replacing the selected Account Service identity before OAuth', async () => {
        endpointState.endpoint = {
            ...endpointState.endpoint,
            serverIdentityId: 'directory-stale',
        };
        credentialGetMock.mockResolvedValueOnce(null);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    server: { canonicalServerUrl: 'https://accounts.example.test' },
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true, enabled: true } } },
                    auth: {
                        methods: [{
                            id: 'okta',
                            actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                        }],
                    },
                },
            },
        });
        const openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-login');

        expect(probeServerFeaturesAtUrlMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts.example.test',
            force: true,
        });
        expect(startOAuthMock).not.toHaveBeenCalled();
        expect(endpointState.set).not.toHaveBeenCalled();
        expect(openUrl).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalledWith(t('common.error'), t('errors.operationFailed'));
        openUrl.mockRestore();
    });

    it('fails closed before OAuth when the selected endpoint has no stable identity', async () => {
        endpointState.endpoint = {
            url: 'https://accounts.example.test',
            displayName: 'Company Account Service',
            source: 'user',
        };
        credentialGetMock.mockResolvedValue(null);
        probeServerFeaturesAtUrlMock.mockResolvedValue({
            status: 'ready',
            features: { capabilities: {} },
        });
        const openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-login');

        expect(startOAuthMock).not.toHaveBeenCalled();
        expect(openUrl).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalled();
        openUrl.mockRestore();
    });

    it('does not treat a same-URL credential for another Account Service identity as connected', async () => {
        endpointState.endpoint = {
            ...endpointState.endpoint,
            serverIdentityId: 'directory-new',
        };
        credentialGetMock.mockImplementationOnce(async (target?: unknown) => {
            const serverIdentityId = target
                && typeof target === 'object'
                && 'serverIdentityId' in target
                && typeof target.serverIdentityId === 'string'
                ? target.serverIdentityId
                : null;
            return serverIdentityId === 'directory-old' ? { token: 'old-token' } : null;
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-login')).not.toBeNull());
        expect(credentialGetMock).toHaveBeenCalledWith({
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'directory-new',
        });
        expect(createAccountDirectorySessionMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-service-refresh')).toBeNull();
    });

    it('rejects an unsafe authorize URL and clears only the pending Account Service attempt', async () => {
        credentialGetMock.mockResolvedValueOnce(null);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    server: { canonicalServerUrl: 'https://accounts.example.test' },
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true, enabled: true } } },
                    auth: {
                        methods: [{
                            id: 'okta',
                            actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                        }],
                    },
                },
            },
        });
        startOAuthMock.mockResolvedValueOnce('javascript:alert(1)');
        const openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-login')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-login');

        expect(openUrl).not.toHaveBeenCalled();
        expect(clearPendingAccountDirectoryAuthMock).toHaveBeenCalledWith({
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
        });
        expect(alertAsyncMock).toHaveBeenCalled();
        openUrl.mockRestore();
    });

    it('runs refresh and preferred enrollment through the selected Account Service without changing Home focus', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();

        await screen.pressByTestIdAsync('settings-account-service-refresh');

        expect(createAccountDirectorySessionMock).not.toHaveBeenCalled();
        expect(refreshMock).toHaveBeenCalledWith(session, expect.objectContaining({
            shouldCancel: expect.any(Function),
        }));
        expect(enrollMock).toHaveBeenCalledWith(session, expect.objectContaining({
            shouldCancel: expect.any(Function),
        }));
    });

    it('selects and disconnects only the Account Service endpoint', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        await screen.pressByTestIdAsync('settings-account-service-select');
        expect(endpointState.set).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://new-accounts.example.test',
            serverIdentityId: 'directory-1',
            source: 'user',
        }));

        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-disconnect')).not.toBeNull());
        await screen.pressByTestIdAsync('settings-account-service-disconnect');
        expect(logoutMock).toHaveBeenCalledOnce();
    });

    it('keeps the Account Service connected and reports failure when credential cleanup fails', async () => {
        logoutMock.mockResolvedValueOnce(false);
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-disconnect')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-disconnect');

        expect(logoutMock).toHaveBeenCalledOnce();
        expect(screen.findByTestId('settings-account-service-disconnect')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-login')).toBeNull();
        expect(alertAsyncMock).toHaveBeenCalledWith(t('common.error'), t('errors.operationFailed'));
    });

    it('keeps the previous Account Service selection when endpoint probing cannot bind an identity', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({ status: 'error', reason: 'network' });

        await screen.pressByTestIdAsync('settings-account-service-select');

        expect(endpointState.set).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalled();
    });

    it('keeps the previous Account Service selection when identity is ready but Home Directory capability is missing', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-2',
            features: { capabilities: {} },
        });

        await screen.pressByTestIdAsync('settings-account-service-select');

        expect(endpointState.set).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalled();
    });

    it('shows refreshed Homes with preferred status and sets preferred without changing focus', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://focused-home.test',
            name: 'Focused Home',
            source: 'manual',
        });
        profiles.setActiveServerId(focused.id);
        const focusedServerId = profiles.getActiveServerSnapshot().serverId;
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull());
        expect(screen.getTextContent()).toContain('Home A');
        expect(screen.getTextContent()).toContain('Home B');
        expect(screen.findByTestId('settings-account-service-home-home-b-preferred')).not.toBeNull();

        provisionAuthenticatedHomeLinkMock.mockClear();
        enrollMock.mockClear();
        getCredentialsMock.mockClear();
        sessionRefreshMock.mockImplementationOnce(async () => {
            publishSessionSnapshot({
                ...session.snapshot,
                homes: session.snapshot.homes.map((home) => ({
                    ...home,
                    preferred: home.homeServerIdentityId === 'home-a',
                })),
                preferredHomeServerIdentityId: 'home-a',
            });
            return session.snapshot;
        });
        enrollMock.mockImplementationOnce(async (...args: unknown[]) => {
            const requestedSession = args[0] as typeof session;
            expect(requestedSession.snapshot.preferredHomeServerIdentityId).toBe('home-a');
            return {
                kind: 'approval_required',
                homeServerIdentityId: 'home-a',
                approvalId: 'approval-home-a',
                expiresAtMs: Date.now() + 60_000,
                resume: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
                cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
            };
        });
        await screen.pressByTestIdAsync('settings-account-service-home-home-a-set-preferred');

        expect(setPreferredHomeMock).toHaveBeenCalledWith('home-a');
        expect(sessionRefreshMock).toHaveBeenCalledOnce();
        expect(provisionAuthenticatedHomeLinkMock).not.toHaveBeenCalled();
        expect(enrollMock).toHaveBeenCalledWith(session, expect.objectContaining({
            shouldCancel: expect.any(Function),
        }));
        expect(getCredentialsMock).not.toHaveBeenCalled();
        expect(screen.findAllByTestId('settings-account-service-home-home-a')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t('settingsAccount.accountServiceHomeApprovalRequired'));
        expect(screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail ?? '')
            .not.toContain(t('settingsAccount.accountServiceHomeApprovalRequired'));
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedServerId);
    });

    it.each([
        ['rejected', 'connect.pairingRejectedBody'],
        ['expired', 'settingsAccount.accountServiceOAuth.errors.expired.body'],
        ['failed', 'settingsAccount.accountServiceHomeConnectionFailed'],
    ] as const)('projects a refresh/enroll %s on the preferred Home row without mutating focus', async (kind, translationKey) => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focusedServerId = profiles.getActiveServerSnapshot().serverId;
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        enrollMock.mockResolvedValueOnce(kind === 'failed'
            ? { kind, error: new Error('offline') }
            : { kind });

        await screen.pressByTestIdAsync('settings-account-service-refresh');

        expect(screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t(translationKey));
        expect(screen.findByTestId('settings-account-service-home-home-b-enroll')?.props.accessibilityLabel)
            .toBe(t(kind === 'failed'
                ? 'settingsAccount.accountServiceRetryHomeConnection'
                : 'settingsAccount.accountServiceConnectHome'));
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedServerId);
    });

    it('projects an uncertain credential rollback as a target-qualified partial commit', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a-set-preferred')).not.toBeNull());
        sessionRefreshMock.mockImplementationOnce(async () => {
            publishSessionSnapshot({
                ...session.snapshot,
                homes: session.snapshot.homes.map((home) => ({
                    ...home,
                    preferred: home.homeServerIdentityId === 'home-a',
                })),
                preferredHomeServerIdentityId: 'home-a',
            });
            return session.snapshot;
        });
        enrollMock.mockResolvedValueOnce({
            kind: 'partial_commit',
            adoptionError: new Error('profile adoption failed'),
            canonicalServerUrl: 'https://home-a.example.test',
            homeServerIdentityId: 'home-a',
            rollbackOutcome: { kind: 'not_applied', reason: 'ownership_changed' },
        });

        await screen.pressByTestIdAsync('settings-account-service-home-home-a-set-preferred');

        expect(screen.findAllByTestId('settings-account-service-home-home-a')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t('connect.homeEnrollmentPartialCommitBody'));
        expect(screen.findByTestId('settings-account-service-home-home-a-enroll')?.props.accessibilityLabel)
            .toBe(t('settingsAccount.accountServiceRetryHomeConnection'));
    });

    it('derives durable enrollment from the canonical Home profile and credential storage', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        await profiles.adoptHomeProfile({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_durable_home_b',
                canonicalServerUrl: 'https://home-b.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.example.test' }],
            },
            source: 'account-directory',
            preserveUserLabel: true,
            suggestedName: 'Home B',
        });
        getCredentialsMock.mockResolvedValue({ token: 'durable-home-b-token' });
        enrollMock.mockResolvedValueOnce({ kind: 'failed', error: new Error('late retry failed') });
        refreshMock.mockImplementationOnce(async () => {
            publishSessionSnapshot({
                ...session.snapshot,
                status: 'ready',
                homes: [{
                    v: 1,
                    homeServerIdentityId: 'srv_durable_home_b',
                    canonicalServerUrl: 'https://home-b.example.test',
                    label: 'Home B',
                    connectionDescriptor: {
                        v: 1,
                        homeServerIdentityId: 'srv_durable_home_b',
                        canonicalServerUrl: 'https://home-b.example.test',
                        revision: 1,
                        endpoints: [{ kind: 'https', url: 'https://home-b.example.test' }],
                    },
                    createdAtMs: 1,
                    updatedAtMs: 1,
                    preferred: true,
                }],
                preferredHomeServerIdentityId: 'srv_durable_home_b',
            });
            return session.snapshot;
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await vi.waitFor(() => expect(screen.findAllByTestId('settings-account-service-home-srv_durable_home_b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t('settingsAccount.accountServiceHomeConnected')));
    });

    it('invalidates a late refresh when the selected Account Service identity changes', async () => {
        credentialGetMock.mockImplementation(async (target?: unknown) => {
            const identity = target && typeof target === 'object' && 'serverIdentityId' in target
                ? target.serverIdentityId
                : null;
            return identity === 'directory-1' ? { token: 'directory-token' } : null;
        });
        let resolveRefresh: ((value: typeof session.snapshot) => void) | null = null;
        refreshMock.mockImplementationOnce((...args: unknown[]) => new Promise<TestDirectorySessionSnapshot>((resolve) => {
            const options = args[1] as { shouldCancel?: () => boolean } | undefined;
            resolveRefresh = (snapshot) => {
                expect(options?.shouldCancel?.()).toBe(true);
                resolve(snapshot);
            };
        }));
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());

        await act(async () => {
            endpointState.endpoint = {
                url: 'https://accounts.example.test',
                serverIdentityId: 'directory-2',
                displayName: 'Replacement Account Service',
                source: 'user',
            };
            for (const listener of endpointState.listeners) listener();
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(cancelPendingPreferredHomeEnrollmentMock).toHaveBeenCalled());
        await act(async () => resolveRefresh?.(session.snapshot));
        await vi.waitFor(() => expect(enrollMock).not.toHaveBeenCalled());

        expect(enrollMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-service-home-home-a')).toBeNull();
    });

    it('disconnect cancels preferred enrollment and prevents its late result from projecting', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a-set-preferred')).not.toBeNull());
        sessionRefreshMock.mockImplementationOnce(async () => {
            publishSessionSnapshot({
                ...session.snapshot,
                homes: session.snapshot.homes.map((home) => ({
                    ...home,
                    preferred: home.homeServerIdentityId === 'home-a',
                })),
                preferredHomeServerIdentityId: 'home-a',
            });
            return session.snapshot;
        });
        let resolveEnrollment: ((value: PreferredDirectoryHomeEnrollmentResult) => void) | null = null;
        enrollMock.mockImplementationOnce((...args: unknown[]) => new Promise<PreferredDirectoryHomeEnrollmentResult>((resolve) => {
            const options = args[1] as {
            shouldCancel?: () => boolean;
            shouldInvalidateContinuation?: () => boolean;
            } | undefined;
            resolveEnrollment = (value) => {
                expect(options?.shouldCancel?.()).toBe(true);
                expect(options?.shouldInvalidateContinuation?.()).toBe(true);
                resolve(value);
            };
        }));
        await screen.pressByTestIdAsync('settings-account-service-home-home-a-set-preferred');
        await vi.waitFor(() => expect(enrollMock).toHaveBeenCalled());

        await screen.pressByTestIdAsync('settings-account-service-disconnect');
        await act(async () => resolveEnrollment?.({
            kind: 'approval_required',
            homeServerIdentityId: 'home-a',
            approvalId: 'late-approval',
            expiresAtMs: Date.now() + 60_000,
            resume: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
            cancel: vi.fn(async (): Promise<HomeLoginContinuationResult> => ({ kind: 'cancelled' })),
        }));
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).toBeNull());

        expect(cancelPendingPreferredHomeEnrollmentMock).toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-service-home-home-a')).toBeNull();
        expect(screen.getTextContent()).not.toContain(t('settingsAccount.accountServiceHomeApprovalRequired'));
    });

    it('removes only the Directory entry, then refreshes while preserving local Home state', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const localHome = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Local Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'home-a');
        profiles.setActiveServerId(localHome.id);
        const beforeProfiles = profiles.listServerProfiles();
        const focusedServerId = profiles.getActiveServerSnapshot().serverId;
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);

        provisionAuthenticatedHomeLinkMock.mockClear();
        enrollMock.mockClear();
        getCredentialsMock.mockClear();
        const actions = screen.findAllByType(ItemRowActions)
            .find((node) => node.props.title === 'Home A')
            ?.props.actions as Array<{ id: string; onPress: () => void | Promise<void> }> | undefined;
        const remove = actions?.find((action) => action.id === 'settings-account-service-home-home-a-remove');
        expect(remove).toBeDefined();
        await act(async () => remove?.onPress());

        expect(confirmMock).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ destructive: true }));
        expect(deleteHomeMock).toHaveBeenCalledWith('home-a');
        expect(sessionRefreshMock).toHaveBeenCalledOnce();
        expect(provisionAuthenticatedHomeLinkMock).not.toHaveBeenCalled();
        expect(enrollMock).not.toHaveBeenCalled();
        expect(getCredentialsMock).not.toHaveBeenCalled();
        expect(profiles.listServerProfiles()).toEqual(beforeProfiles);
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedServerId);
    });

    it('surfaces a preferred mutation failure and preserves the refreshed Home projection', async () => {
        setPreferredHomeMock.mockRejectedValueOnce(new Error('offline'));
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await waitForAutomaticHydration(screen);
        clearAutomaticHydrationCalls();

        await screen.pressByTestIdAsync('settings-account-service-home-home-a-set-preferred');

        expect(alertAsyncMock).toHaveBeenCalledWith(t('common.error'), t('errors.operationFailed'));
        expect(sessionRefreshMock).not.toHaveBeenCalled();
        expect(refreshMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull();
    });
});
