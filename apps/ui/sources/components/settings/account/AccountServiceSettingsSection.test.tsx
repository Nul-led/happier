import * as React from 'react';
import { Linking } from 'react-native';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { t } from '@/text';

const endpointState = vi.hoisted(() => ({
    endpoint: {
        url: 'https://accounts.example.test',
        displayName: 'Company Account Service',
        source: 'user' as const,
    } as {
        url: string;
        serverIdentityId?: string;
        displayName: string;
        source: 'user';
    },
    set: vi.fn(),
    listeners: new Set<() => void>(),
}));
const credentialGetMock = vi.hoisted(() => vi.fn(
    async (_target?: unknown): Promise<{ token: string } | null> => ({ token: 'directory-token' }),
));
const refreshMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ status: 'ready' })));
const enrollMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ kind: 'enrolled', homeServerIdentityId: 'home-b' })));
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
const session = vi.hoisted(() => ({
    snapshot: {
        endpoint: 'https://accounts.example.test',
        status: 'idle',
        account: null,
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
    logout: logoutMock,
    setPreferredHome: setPreferredHomeMock,
    deleteHome: deleteHomeMock,
    refresh: sessionRefreshMock,
}));
const createAccountDirectorySessionMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => session));
const cancelPendingPreferredHomeEnrollmentMock = vi.hoisted(() => vi.fn(async () => {}));
const pendingEnrollmentState = vi.hoisted(() => ({
    value: null as null | Readonly<{
        kind: 'approval_required';
        homeServerIdentityId: string;
        approvalId: string;
        expiresAtMs: number;
        resume: () => Promise<unknown>;
        cancel: () => Promise<unknown>;
    }>,
    listeners: new Set<() => void>(),
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

vi.mock('@/auth/accountDirectory/accountDirectoryAuthClient', () => ({
    accountDirectoryAuthClient: {
        startOAuth: startOAuthMock,
        loginWithKey: loginWithKeyMock,
    },
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: getCredentialsMock,
        clearPendingAccountDirectoryAuth: clearPendingAccountDirectoryAuthMock,
    },
    subscribeHomeCredentialMutations: (listener: () => void) => {
        credentialMutationListeners.add(listener);
        return () => credentialMutationListeners.delete(listener);
    },
}));

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
        pendingEnrollmentState.value = result?.kind === 'approval_required' ? result : null;
        for (const listener of pendingEnrollmentState.listeners) listener();
        return result;
    },
    cancelPendingPreferredHomeEnrollment: async () => {
        await cancelPendingPreferredHomeEnrollmentMock();
        pendingEnrollmentState.value = null;
        for (const listener of pendingEnrollmentState.listeners) listener();
    },
    getPendingPreferredHomeEnrollment: () => pendingEnrollmentState.value,
    subscribePendingPreferredHomeEnrollment: (listener: () => void) => {
        pendingEnrollmentState.listeners.add(listener);
        return () => pendingEnrollmentState.listeners.delete(listener);
    },
}));

const promptMock = vi.hoisted(() => vi.fn(async () => 'https://new-accounts.example.test'));
const alertAsyncMock = vi.hoisted(() => vi.fn(async () => {}));
const confirmMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { prompt: promptMock, alertAsync: alertAsyncMock, confirm: confirmMock } }).module;
});

import { AccountServiceSettingsSection } from './AccountServiceSettingsSection';

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
        pendingEnrollmentState.value = null;
        pendingEnrollmentState.listeners.clear();
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
                    accountDirectory: supportedCapability,
                    oauth: {
                        providers: {
                            oidc: { configured: false },
                            okta: { configured: true },
                            github: { configured: true },
                        },
                    },
                    auth: {
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
            displayName: 'Company Account Service',
            source: 'user',
        };
        endpointState.set.mockClear();
        promptMock.mockClear();
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
        session.subscribe.mockClear();
        session.snapshot = {
            endpoint: 'https://accounts.example.test',
            status: 'idle',
            account: null,
            homes: [],
            preferredHomeServerIdentityId: null,
            refreshedAtMs: null,
            error: null,
        };
        refreshMock.mockImplementation(async () => {
            publishSessionSnapshot({
                endpoint: 'https://accounts.example.test',
                status: 'ready',
                account: null,
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

    it('hides the old service projection synchronously when the endpoint identity changes', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());

        let resolveCredentials: ((value: { token: string } | null) => void) | null = null;
        credentialGetMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCredentials = resolve;
        }));
        act(() => {
            endpointState.endpoint = {
                url: 'https://accounts.example.test',
                serverIdentityId: 'directory-2',
                displayName: 'Replacement Account Service',
                source: 'user',
            };
            for (const listener of endpointState.listeners) listener();
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
        expect(screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t('settingsAccount.accountServiceHomeConnected'));
        endpointState.set.mockClear();
        promptMock.mockResolvedValueOnce(null);

        await screen.pressByTestIdAsync('settings-account-service-select');

        expect(endpointState.set).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-b-preferred')).not.toBeNull();
        expect(screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => typeof node.props.detail === 'string')?.props.detail)
            .toContain(t('settingsAccount.accountServiceHomeConnected'));
    });

    it('keeps same-service Homes visible during refresh and localizes pending state to that work', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());

        let resolveRefresh: ((value: typeof session.snapshot) => void) | null = null;
        refreshMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveRefresh = resolve;
        }));
        const refreshPress = screen.pressByTestIdAsync('settings-account-service-refresh');

        await vi.waitFor(() => expect(screen.findAllByTestId('settings-account-service-refresh').some((node) => node.props.loading === true)).toBe(true));
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-disconnect')?.props.disabled).not.toBe(true);

        await act(async () => resolveRefresh?.(session.snapshot));
        await refreshPress;
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
        const unsupportedScreen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(unsupportedScreen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: {} },
        });
        await unsupportedScreen.pressByTestIdAsync('settings-account-service-refresh');
        expect(unsupportedScreen.findByTestId('settings-account-service-directory-unsupported')).not.toBeNull();

        refreshMock.mockResolvedValueOnce({
            ...session.snapshot,
            status: 'ready',
            homes: [],
            preferredHomeServerIdentityId: null,
        });
        const emptyScreen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(emptyScreen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        await emptyScreen.pressByTestIdAsync('settings-account-service-refresh');
        expect(emptyScreen.findByTestId('settings-account-service-directory-empty')).not.toBeNull();

        const unavailableScreen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(unavailableScreen.findByTestId('settings-account-service-refresh')).not.toBeNull());
        await unavailableScreen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(unavailableScreen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({ status: 'error', reason: 'network' });
        await unavailableScreen.pressByTestIdAsync('settings-account-service-refresh');
        expect(unavailableScreen.findByTestId('settings-account-service-directory-unavailable')).not.toBeNull();
        expect(unavailableScreen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
    });

    it('offers reconnection when the Account Service credential has expired', async () => {
        const expired = Object.assign(new Error('expired'), { status: 401 });
        refreshMock.mockResolvedValueOnce({
            ...session.snapshot,
            status: 'error',
            error: expired,
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-refresh');

        expect(screen.findByTestId('settings-account-service-directory-credential-expired')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-login')).not.toBeNull();
    });

    it('keeps Home identity secondary and exposes explicit preferred status and action text', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull());

        const preferred = screen.findAllByTestId('settings-account-service-home-home-b')
            .find((node) => node.props.title === 'Home B');
        expect(preferred?.props.title).toBe('Home B');
        expect(preferred?.props.subtitle).toBe('https://home-b.test');
        expect(preferred?.props.accessibilityLabel).toContain(t('settingsAccount.accountServicePreferredHome'));
        expect(preferred?.props.rightElement).toBeTruthy();
        expect(screen.findAllByTestId('settings-account-service-refresh').find((node) => node.props.subtitle)?.props.subtitle)
            .toBe(t('settingsAccount.accountServiceDiscoveryDescription'));
    });

    it('fails closed before restricted OAuth when Account Directory capability is missing', async () => {
        credentialGetMock.mockResolvedValueOnce(null);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    oauth: { providers: { okta: { configured: true } } },
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
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true } } },
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
            providerId: 'okta',
            mode: 'keyed',
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
        expect(refreshMock).toHaveBeenCalledWith(session);
        expect(enrollMock).toHaveBeenCalledWith(session);
        expect(startOAuthMock).not.toHaveBeenCalled();
        expect(openUrl).not.toHaveBeenCalled();
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedServerId);
        openUrl.mockRestore();
    });

    it('captures the focused authenticated Home identity into the Directory OAuth start', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        credentialGetMock.mockResolvedValueOnce(null);
        getCredentialsMock.mockResolvedValueOnce({ token: 'home-a-token' });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: {
                capabilities: {
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true } } },
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

        expect(startOAuthMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            homeServerIdentityId: 'srv_home_a',
        }));
        expect(getCredentialsMock).toHaveBeenCalledWith(
            'https://home-a.test',
            { serverId: 'srv_home_a' },
        );
        const startInput = startOAuthMock.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(startInput).not.toHaveProperty('credentials');
        expect(startInput).not.toHaveProperty('connectionDescriptor');
        openUrl.mockRestore();
    });

    it('re-provisions the authenticated Home relationship before directory refresh and enrollment', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        getCredentialsMock.mockResolvedValueOnce({ token: 'home-a-token' });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-refresh');

        expect(createAccountDirectorySessionMock).toHaveBeenCalledWith(
            {
                endpoint: 'https://accounts.example.test',
                serverIdentityId: 'directory-1',
            },
            { capability: supportedCapability },
        );
        expect(provisionAuthenticatedHomeLinkMock).toHaveBeenCalledWith(expect.objectContaining({
            session,
            homeServerIdentityId: 'srv_home_a',
            issuerServerIdentityId: 'directory-1',
            capability: supportedCapability,
        }));
        const provisionOrder = provisionAuthenticatedHomeLinkMock.mock.invocationCallOrder[0];
        const refreshOrder = refreshMock.mock.invocationCallOrder[0];
        expect(provisionOrder).toBeLessThan(refreshOrder);
        expect(refreshMock).toHaveBeenCalledWith(session);
        expect(enrollMock).toHaveBeenCalledWith(session);
    });

    it('confirms an exact signing-key conflict before explicitly re-linking through the same provision path', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        getCredentialsMock.mockResolvedValueOnce({ token: 'home-a-token' });
        provisionAuthenticatedHomeLinkMock
            .mockResolvedValueOnce({ kind: 'relink_required', homeServerIdentityId: 'srv_home_a' })
            .mockResolvedValueOnce({ kind: 'linked', homeServerIdentityId: 'srv_home_a' });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-refresh');

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
        expect(refreshMock).toHaveBeenCalledWith(session);
        expect(enrollMock).toHaveBeenCalledWith(session);
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
        getCredentialsMock.mockResolvedValueOnce({ token: 'home-a-token' });
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
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-refresh');

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
        getCredentialsMock.mockResolvedValueOnce({ token: 'home-a-token' });
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
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-refresh');

        await vi.waitFor(() => expect(alertAsyncMock).toHaveBeenCalledOnce());
        expect(provisionAuthenticatedHomeLinkMock).toHaveBeenCalledOnce();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(refreshMock).not.toHaveBeenCalled();
        expect(enrollMock).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalledWith(t('common.error'), t('errors.operationFailed'));
    });

    it('re-probes and replaces a stale persisted Account Service identity before OAuth', async () => {
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
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true } } },
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
        expect(startOAuthMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointServerIdentityId: 'directory-1',
            providerId: 'okta',
        }));
        expect(endpointState.set).toHaveBeenCalledWith(expect.objectContaining({
            serverIdentityId: 'directory-1',
        }));
        openUrl.mockRestore();
    });

    it('fails closed before OAuth when the selected endpoint has no stable identity', async () => {
        credentialGetMock.mockResolvedValueOnce(null);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
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
                    accountDirectory: supportedCapability,
                    oauth: { providers: { okta: { configured: true } } },
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
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { accountDirectory: supportedCapability } },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-refresh')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-refresh');

        expect(createAccountDirectorySessionMock).toHaveBeenCalledWith(
            {
                endpoint: 'https://accounts.example.test',
                serverIdentityId: 'directory-1',
            },
            { capability: supportedCapability },
        );
        expect(refreshMock).toHaveBeenCalledWith(session);
        expect(enrollMock).toHaveBeenCalledWith(session);
    });

    it('selects and disconnects only the Account Service endpoint', async () => {
        const screen = await renderScreen(<AccountServiceSettingsSection />);
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
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({ status: 'error', reason: 'network' });
        const screen = await renderScreen(<AccountServiceSettingsSection />);

        await screen.pressByTestIdAsync('settings-account-service-select');

        expect(endpointState.set).not.toHaveBeenCalled();
        expect(alertAsyncMock).toHaveBeenCalled();
    });

    it('keeps the previous Account Service selection when identity is ready but Home Directory capability is missing', async () => {
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: 'directory-2',
            features: { capabilities: {} },
        });
        const screen = await renderScreen(<AccountServiceSettingsSection />);

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
        await screen.pressByTestIdAsync('settings-account-service-home-home-a-set-preferred');

        expect(setPreferredHomeMock).toHaveBeenCalledWith('home-a');
        expect(sessionRefreshMock).toHaveBeenCalledOnce();
        expect(provisionAuthenticatedHomeLinkMock).not.toHaveBeenCalled();
        expect(enrollMock).not.toHaveBeenCalled();
        expect(getCredentialsMock).not.toHaveBeenCalled();
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedServerId);
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
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a-remove')).not.toBeNull());

        provisionAuthenticatedHomeLinkMock.mockClear();
        enrollMock.mockClear();
        getCredentialsMock.mockClear();
        await screen.pressByTestIdAsync('settings-account-service-home-home-a-remove');

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
        await screen.pressByTestIdAsync('settings-account-service-refresh');
        await vi.waitFor(() => expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull());

        await screen.pressByTestIdAsync('settings-account-service-home-home-a-set-preferred');

        expect(alertAsyncMock).toHaveBeenCalledWith(t('common.error'), t('errors.operationFailed'));
        expect(sessionRefreshMock).not.toHaveBeenCalled();
        expect(refreshMock).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('settings-account-service-home-home-a')).not.toBeNull();
        expect(screen.findByTestId('settings-account-service-home-home-b')).not.toBeNull();
    });
});
