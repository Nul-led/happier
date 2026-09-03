import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import {
    accountDirectoryCredentialSetSpy,
    accountDirectoryCredentialGetSpy,
    clearPendingExternalAuthMock,
    flushOAuthEffects,
    localSearchParamsMock,
    loginSpy,
    loginWithCredentialsSpy,
    modal,
    pendingAccountDirectoryAuthClearSpy,
    pendingAccountDirectoryAuthGetSpy,
    replaceSpy,
    renderOAuthReturnScreen,
    resetOAuthHarness,
    runWithOAuthScreen,
    setPendingAccountDirectoryAuthState,
    setPendingExternalAuthState,
    upsertAndActivateServerSpy,
} from '@/auth/providers/github/test/oauthReturnHarness';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { AccountDirectoryStorageReadError, TokenStorage } from '@/auth/storage/tokenStorage';
import { renderScreen } from '@/dev/testkit';
import type { PreferredDirectoryHomeEnrollmentResult } from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import { setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import { createHomeCredentialDestinationDigestV1 } from '@happier-dev/protocol';

const setActiveServerAndSwitchSpy = vi.hoisted(() => vi.fn(async (_params: unknown) => 'switched' as const));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: (params: unknown) => setActiveServerAndSwitchSpy(params),
}));
vi.mock('@/sync/domains/server/selection/serverSelectionScope', () => ({
    resolveRoutineServerSelectionScope: () => 'tab' as const,
}));
vi.mock('@/utils/platform/desktopHost', () => ({
    isDesktopHost: () => false,
}));

const accountDirectoryComposition = vi.hoisted(() => ({
    useRealOwners: false,
    enrollmentResult: null as unknown,
}));
const createAccountDirectorySessionSpy = vi.hoisted(() => vi.fn(
    (..._args: unknown[]) => ({ snapshot: { status: 'idle' } }),
));
const refreshAccountHomeDirectorySpy = vi.hoisted(() => vi.fn(
    async (..._args: unknown[]) => ({ status: 'ready' }),
));
const enrollPreferredDirectoryHomeSpy = vi.hoisted(() => vi.fn<
    (..._args: unknown[]) => Promise<PreferredDirectoryHomeEnrollmentResult>
>(async () => ({ kind: 'enrolled', homeServerIdentityId: 'home-b' })));
const probeServerFeaturesAtUrlSpy = vi.hoisted(() => vi.fn<
    (..._args: unknown[]) => Promise<unknown>
>(async () => undefined));
const startAccountDirectoryOAuthSpy = vi.hoisted(() => vi.fn(
    async (..._args: unknown[]) => 'https://oauth.example.test/authorize-keyed',
));
const supportedCapability = {
    version: 1,
    homeDirectory: true,
    homeEnrollment: true,
    homeLoginAssertion: {
        keyId: 'a'.repeat(64),
        publicKeyBase64Url: 'A'.repeat(43),
    },
};

vi.mock('@/sync/domains/accountDirectory/accountDirectorySession', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/accountDirectory/accountDirectorySession')>();
    return {
        ...actual,
        createAccountDirectorySession: (...args: Parameters<typeof actual.createAccountDirectorySession>) => accountDirectoryComposition.useRealOwners
            ? actual.createAccountDirectorySession(...args)
            : createAccountDirectorySessionSpy(...args),
    };
});
vi.mock('@/sync/ops/accountDirectory/refreshAccountHomeDirectory', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/ops/accountDirectory/refreshAccountHomeDirectory')>();
    return {
        ...actual,
        refreshAccountHomeDirectory: (...args: Parameters<typeof actual.refreshAccountHomeDirectory>) => accountDirectoryComposition.useRealOwners
            ? actual.refreshAccountHomeDirectory(...args)
            : refreshAccountHomeDirectorySpy(...args),
    };
});
vi.mock('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome')>();
    return {
        ...actual,
        enrollPreferredDirectoryHome: async (...args: Parameters<typeof actual.enrollPreferredDirectoryHome>) => {
            const result = accountDirectoryComposition.useRealOwners
                ? await actual.enrollPreferredDirectoryHome(...args)
                : await enrollPreferredDirectoryHomeSpy(...args);
            accountDirectoryComposition.enrollmentResult = result;
            return result;
        },
    };
});
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: (...args: unknown[]) => probeServerFeaturesAtUrlSpy(...args),
}));
vi.mock('@/auth/accountDirectory/accountDirectoryAuthClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/accountDirectory/accountDirectoryAuthClient')>();
    return {
        ...actual,
        accountDirectoryAuthClient: {
            ...actual.accountDirectoryAuthClient,
            startOAuth: (...args: Parameters<typeof actual.accountDirectoryAuthClient.startOAuth>) => (
                startAccountDirectoryOAuthSpy(...args)
            ),
        },
    };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@shopify/react-native-skia', () => ({}));

beforeEach(() => {
    accountDirectoryComposition.useRealOwners = false;
    accountDirectoryComposition.enrollmentResult = null;
    resetOAuthHarness();
    probeServerFeaturesAtUrlSpy.mockReset();
    probeServerFeaturesAtUrlSpy.mockImplementation(async (...args: unknown[]) => {
        const input = args[0];
        if (
            typeof input !== 'object'
            || input === null
            || !('endpointUrl' in input)
            || typeof input.endpointUrl !== 'string'
        ) {
            throw new TypeError('Expected an endpoint URL');
        }
        return {
            status: 'ready',
            serverIdentityId: 'srv_directory_1',
            features: {
                capabilities: {
                    server: { canonicalServerUrl: input.endpointUrl.replace(/\/+$/, '') },
                    accountDirectory: supportedCapability,
                },
            },
        };
    });
    startAccountDirectoryOAuthSpy.mockClear();
    setActiveServerAndSwitchSpy.mockClear();
    setActiveServerAndSwitchSpy.mockResolvedValue('switched');
});

afterEach(() => {
    resetRuntimeFetch();
    vi.unstubAllGlobals();
    resetOAuthHarness();
    createAccountDirectorySessionSpy.mockClear();
    refreshAccountHomeDirectorySpy.mockClear();
    enrollPreferredDirectoryHomeSpy.mockClear();
});

describe('oauth/[provider] return (Account Directory)', () => {
    it.each([undefined, 'open_home'])('rejects a callback whose persisted entry intent is %j', async (entryIntent) => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', purpose: 'account_directory',
            credentialTarget: 'account_directory', endpointUrl: endpoint,
            endpointServerIdentityId: identity, canonicalServerUrl: endpoint,
            pending: 'directory-pending', mode: 'keyless',
        });
        setAccountServiceEndpoint({ url: endpoint, serverIdentityId: identity, source: 'user' });
        pendingAccountDirectoryAuthGetSpy.mockResolvedValueOnce({
            endpoint,
            serverIdentityId: identity,
            canonicalServerUrl: endpoint,
            credentialTarget: 'account_directory',
            entryIntent,
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
        } as unknown as import('@/auth/storage/tokenStorage').PendingAccountDirectoryAuth);
        const fetchMock = vi.fn();
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(8);
            expect(fetchMock).not.toHaveBeenCalled();
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
            expect(setActiveServerAndSwitchSpy).not.toHaveBeenCalled();
        });
    });

    it('starts a fresh keyed continuation when an unlinked keyless login requires keyed authentication', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', purpose: 'account_directory',
            credentialTarget: 'account_directory', endpointUrl: endpoint,
            endpointServerIdentityId: identity, pending: 'directory-pending', mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint, serverIdentityId: identity, credentialTarget: 'account_directory',
            entryIntent: 'enter_preferred_home',
            provider: 'github', purpose: 'account_directory', pending: 'directory-pending',
            createdAt: now - 100, expiresAt: now + 60_000, mode: 'keyless',
            proof: 'directory-proof', returnTo: '/settings/account',
        });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({
            error: 'keyed-authentication-required',
        }), { status: 403, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            expect(startAccountDirectoryOAuthSpy).toHaveBeenCalledWith({
                endpointUrl: endpoint,
                endpointServerIdentityId: identity,
                canonicalServerUrl: endpoint,
                providerId: 'github',
                mode: 'keyed',
                entryIntent: 'enter_preferred_home',
                returnTo: '/settings/account',
            });
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
        });
    });

    it('does not commit a late callback after the selected Account Service changes during exchange', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', purpose: 'account_directory',
            credentialTarget: 'account_directory', endpointUrl: endpoint,
            endpointServerIdentityId: identity, pending: 'directory-pending', mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint, serverIdentityId: identity, credentialTarget: 'account_directory',
            provider: 'github', purpose: 'account_directory', pending: 'directory-pending',
            createdAt: now - 100, expiresAt: now + 60_000, mode: 'keyless',
            proof: 'directory-proof', returnTo: '/settings/account',
        });
        let resolveExchange: ((response: Response) => void) | null = null;
        setRuntimeFetch(vi.fn(() => new Promise<Response>((resolve) => { resolveExchange = resolve; })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => expect(resolveExchange).not.toBeNull());
            setAccountServiceEndpoint({
                url: 'https://replacement.example.test',
                serverIdentityId: 'srv_directory_2',
                source: 'user',
            });
            await act(async () => resolveExchange?.(new Response(JSON.stringify({ token: 'late-token' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })));
            await flushOAuthEffects(4);

            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
            expect(refreshAccountHomeDirectorySpy).not.toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('does not publish Directory or enrollment work when service selection changes during credential commit', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', purpose: 'account_directory',
            credentialTarget: 'account_directory', endpointUrl: endpoint,
            endpointServerIdentityId: identity, pending: 'directory-pending', mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint, serverIdentityId: identity, credentialTarget: 'account_directory',
            provider: 'github', purpose: 'account_directory', pending: 'directory-pending',
            createdAt: now - 100, expiresAt: now + 60_000, mode: 'keyless',
            proof: 'directory-proof', returnTo: '/settings/account',
        });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);
        let resolveCommit: ((stored: boolean) => void) | null = null;
        accountDirectoryCredentialSetSpy.mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveCommit = resolve; }));

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => expect(resolveCommit).not.toBeNull());
            setAccountServiceEndpoint({
                url: 'https://replacement.example.test',
                serverIdentityId: 'srv_directory_2',
                source: 'user',
            });
            await act(async () => resolveCommit?.(true));
            await flushOAuthEffects(4);

            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalledOnce();
            expect(refreshAccountHomeDirectorySpy).not.toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('identifies an expired Account Service continuation without attempting token exchange', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 120_000,
            expiresAt: now - 1,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        const fetchMock = vi.fn();
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-error-request_expired',
                })).toBeTruthy();
            });
            expect(fetchMock).not.toHaveBeenCalled();
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
            expect(pendingAccountDirectoryAuthClearSpy).toHaveBeenCalledWith({
                endpoint,
                serverIdentityId: identity,
            });
        } finally {
            act(() => tree.unmount());
        }
    });

    it('does not capture or clear the Directory continuation for an unknown credential target', async () => {
        const now = Date.now();
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'unknown',
            credentialTarget: 'future_target',
            endpointUrl: 'https://directory.example.test',
            endpointServerIdentityId: 'srv_directory_1',
        });
        setPendingAccountDirectoryAuthState({
            endpoint: 'https://directory.example.test',
            serverIdentityId: 'srv_directory_1',
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            createdAt: now - 100,
            expiresAt: now + 60_000,
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(8);
            expect(pendingAccountDirectoryAuthClearSpy).not.toHaveBeenCalled();
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
        });
    });

    it('completes against the persisted endpoint without consuming Home auth or changing focus', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingExternalAuthState({ provider: 'github', proof: 'home-proof' });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });

        const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
            return new Response(JSON.stringify({ success: true, token: 'directory-token' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            await vi.waitFor(() => {
                expect(createAccountDirectorySessionSpy).toHaveBeenCalled();
            });
            expect(fetchMock).toHaveBeenCalled();
            expect(setActiveServerAndSwitchSpy).not.toHaveBeenCalled();
            const [requestInput, requestInit] = fetchMock.mock.calls[0]!;
            const request = requestInput instanceof Request
                ? requestInput.clone()
                : new Request(requestInput, requestInit);
            expect(request.url).toContain(`${endpoint}/v1/auth/external/github/finalize-keyless`);
            await expect(request.json()).resolves.toEqual({
                pending: 'directory-pending',
                proof: 'directory-proof',
            });
            expect(modal.alert).not.toHaveBeenCalled();
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalledWith(
                { endpoint, serverIdentityId: identity },
                { token: 'directory-token' },
            );
            expect(pendingAccountDirectoryAuthClearSpy).toHaveBeenCalled();
            expect(createAccountDirectorySessionSpy).toHaveBeenCalledWith(
                { endpoint, serverIdentityId: identity },
                { capability: supportedCapability },
            );
            expect(refreshAccountHomeDirectorySpy).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ shouldCancel: expect.any(Function) }),
            );
            expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ shouldCancel: expect.any(Function) }),
            );
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
            // The restricted Directory credential lives only in its own namespace: the ordinary
            // Home credential slot for the very same URL/identity stays empty, so a Directory
            // token can never be presented as a Home bearer.
            await expect(TokenStorage.getCredentialsForServerUrl(endpoint, { serverId: identity }))
                .resolves.toBeNull();
            // A continuation without a captured Home intent preserves fresh-device discovery:
            // no Home relationship provisioning is attempted.
            expect(fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)))
                .some((url) => url.includes('/v1/account/directory-links'))).toBe(false);
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
        });
    });

    it('opens only the exact enrolled preferred Home for enter_preferred_home intent', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        const homeIdentity = 'srv_home_entry';
        const profiles = await import('@/sync/domains/server/serverProfiles');
        profiles.upsertServerProfile({
            serverUrl: 'https://home-entry.example.test',
            name: 'Entry Home',
            source: 'account-directory',
        });
        profiles.setServerProfileIdentityForUrl('https://home-entry.example.test', homeIdentity);
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', purpose: 'account_directory',
            credentialTarget: 'account_directory', endpointUrl: endpoint,
            endpointServerIdentityId: identity, pending: 'directory-pending', mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint, serverIdentityId: identity, credentialTarget: 'account_directory',
            entryIntent: 'enter_preferred_home',
            provider: 'github', purpose: 'account_directory', pending: 'directory-pending',
            createdAt: now - 100, expiresAt: now + 60_000, mode: 'keyless',
            proof: 'directory-proof', returnTo: '/',
        });
        enrollPreferredDirectoryHomeSpy.mockResolvedValueOnce({
            kind: 'enrolled',
            homeServerIdentityId: homeIdentity,
        });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(16);
            expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ entryIntent: 'enter_preferred_home' }),
            );
            expect(setActiveServerAndSwitchSpy).toHaveBeenCalledWith({
                serverId: homeIdentity,
                scope: 'tab',
            });
        });
    });

    it('does not open a late enrolled Home after the selected Account Service changes', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        const homeIdentity = 'srv_home_entry';
        const profiles = await import('@/sync/domains/server/serverProfiles');
        profiles.upsertServerProfile({
            serverUrl: 'https://home-entry.example.test',
            name: 'Entry Home',
            source: 'account-directory',
        });
        profiles.setServerProfileIdentityForUrl('https://home-entry.example.test', homeIdentity);
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', purpose: 'account_directory',
            credentialTarget: 'account_directory', endpointUrl: endpoint,
            endpointServerIdentityId: identity, pending: 'directory-pending', mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint, serverIdentityId: identity, credentialTarget: 'account_directory',
            entryIntent: 'enter_preferred_home',
            provider: 'github', purpose: 'account_directory', pending: 'directory-pending',
            createdAt: now - 100, expiresAt: now + 60_000, mode: 'keyless',
            proof: 'directory-proof', returnTo: '/',
        });
        let resolveEnrollment: ((result: PreferredDirectoryHomeEnrollmentResult) => void) | null = null;
        enrollPreferredDirectoryHomeSpy.mockImplementationOnce(async () => await new Promise((resolve) => {
            resolveEnrollment = resolve;
        }));
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await vi.waitFor(() => expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalled());
            setAccountServiceEndpoint({
                url: 'https://replacement-directory.example.test',
                serverIdentityId: 'srv_directory_2',
                source: 'user',
            });
            await act(async () => {
                resolveEnrollment?.({ kind: 'enrolled', homeServerIdentityId: homeIdentity });
            });
            await flushOAuthEffects(8);

            expect(setActiveServerAndSwitchSpy).not.toHaveBeenCalled();
        });
    });

    it('keeps one polite Account Service status region visible while Home discovery is pending', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test/account-service/';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });

        let resolveRefresh: (() => void) | null = null;
        refreshAccountHomeDirectorySpy.mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => {
                resolveRefresh = resolve;
            });
            return { status: 'ready' };
        });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(accountDirectoryCredentialSetSpy).toHaveBeenCalled();
                expect(tree.root.findAllByProps({
                    testID: 'oauth-account-directory-stage-finding_homes',
                    accessibilityLiveRegion: 'polite',
                })).toHaveLength(1);
            });
            expect(tree.root.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(1);
            expect(tree.root.findAllByProps({
                testID: 'oauth-return-wizard-secondary',
            })).toHaveLength(0);
            expect(tree.root.findByProps({
                testID: 'oauth-account-directory-service-identity',
            }).props.children).toContain('directory.example.test/account-service');
        } finally {
            await act(async () => {
                resolveRefresh?.();
            });
            act(() => tree.unmount());
        }
    });

    it('shows stage-specific partial-success recovery after sign-in when Home discovery fails', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        refreshAccountHomeDirectorySpy.mockResolvedValueOnce({ status: 'error' });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-error-directory_refresh_failed',
                })).toBeTruthy();
            });
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalled();
            expect(replaceSpy).not.toHaveBeenCalled();
            expect(modal.alert).not.toHaveBeenCalled();

            await act(async () => {
                await tree.root.findByProps({
                    testID: 'oauth-account-directory-continue',
                }).props.onPress();
            });
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
        } finally {
            act(() => tree.unmount());
        }
    });

    it('continues from a stored Account Service credential when pending cleanup fails', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        pendingAccountDirectoryAuthClearSpy.mockResolvedValueOnce(false);
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalledWith(
                { endpoint, serverIdentityId: identity },
                { token: 'directory-token' },
            );
            expect(refreshAccountHomeDirectorySpy).toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalled();
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
            expect(modal.alert).not.toHaveBeenCalled();
        });
    });

    it('does not commit Account Service authority when cancellation wins the token-exchange race', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });

        let resolveExchange: ((response: Response) => void) | null = null;
        const fetchMock = vi.fn(async () => await new Promise<Response>((resolve) => {
            resolveExchange = resolve;
        }));
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(fetchMock).toHaveBeenCalled();
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-stage-signing_in',
                })).toBeTruthy();
            });
            await act(async () => {
                await tree.root.findByProps({
                    testID: 'oauth-return-wizard-secondary',
                }).props.onPress();
            });
            await act(async () => {
                resolveExchange?.(new Response(JSON.stringify({ token: 'must-not-store' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }));
                await Promise.resolve();
            });
            await flushOAuthEffects(8);

            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
            expect(createAccountDirectorySessionSpy).not.toHaveBeenCalled();
            expect(refreshAccountHomeDirectorySpy).not.toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).not.toHaveBeenCalled();
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
        } finally {
            act(() => tree.unmount());
        }
    });

    it('closes cancellation synchronously before the credential storage commit starts', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        let resolveStorage: ((stored: boolean) => void) | null = null;
        accountDirectoryCredentialSetSpy.mockImplementationOnce(async () => await new Promise<boolean>((resolve) => {
            resolveStorage = resolve;
        }));
        let resolveExchange: ((response: Response) => void) | null = null;
        setRuntimeFetch(vi.fn(async () => await new Promise<Response>((resolve) => {
            resolveExchange = resolve;
        })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-stage-signing_in',
                })).toBeTruthy();
            });
            const staleCancel = tree.root.findByProps({
                testID: 'oauth-return-wizard-secondary',
            }).props.onPress as () => Promise<void>;
            await act(async () => {
                resolveExchange?.(new Response(JSON.stringify({ token: 'directory-token' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }));
            });
            await vi.waitFor(() => {
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-stage-signing_in',
                })).toBeTruthy();
            });
            expect(tree.root.findAllByProps({
                testID: 'oauth-account-directory-stage-saving_credentials',
            })).toHaveLength(0);
            expect(tree.root.findAllByProps({
                testID: 'oauth-return-wizard-secondary',
            })).toHaveLength(0);
            await act(async () => {
                await staleCancel();
            });
            expect(pendingAccountDirectoryAuthClearSpy).not.toHaveBeenCalled();
            expect(replaceSpy).not.toHaveBeenCalled();

            await act(async () => {
                resolveStorage?.(true);
            });
            await flushOAuthEffects(8);
            expect(refreshAccountHomeDirectorySpy).toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('keeps Home discovery as one visible stage while preferred enrollment begins', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        let resolveEnrollment: ((result: PreferredDirectoryHomeEnrollmentResult) => void) | null = null;
        enrollPreferredDirectoryHomeSpy.mockImplementationOnce(async () => await new Promise((resolve) => {
            resolveEnrollment = resolve;
        }));
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalled();
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-stage-finding_homes',
                    accessibilityLiveRegion: 'polite',
                })).toBeTruthy();
            });
            expect(tree.root.findAllByProps({
                testID: 'oauth-account-directory-stage-connecting_home',
            })).toHaveLength(0);
        } finally {
            await act(async () => {
                resolveEnrollment?.({ kind: 'enrolled', homeServerIdentityId: 'home-b' });
            });
            act(() => tree.unmount());
        }
    });

    it('returns successful Account Service sign-in to settings when Home enrollment is unsupported', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        probeServerFeaturesAtUrlSpy.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: identity,
            features: {
                capabilities: {
                    server: { canonicalServerUrl: endpoint },
                    accountDirectory: {
                        ...supportedCapability,
                        homeEnrollment: false,
                    },
                },
            },
        });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        let resolveRefresh: ((result: { status: 'ready' }) => void) | null = null;
        refreshAccountHomeDirectorySpy.mockImplementationOnce(async () => await new Promise((resolve) => {
            resolveRefresh = resolve;
        }));

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(refreshAccountHomeDirectorySpy).toHaveBeenCalled();
            });
            replaceSpy.mockClear();
            await act(async () => {
                resolveRefresh?.({ status: 'ready' });
            });
            await vi.waitFor(() => {
                expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-stage-finding_homes',
                })).toBeTruthy();
                expect(tree.root.findAllByProps({
                    testID: 'oauth-account-directory-stage-connected',
                })).toHaveLength(0);
            });
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalled();
            expect(refreshAccountHomeDirectorySpy).toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).not.toHaveBeenCalled();
            expect(modal.alert).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('commits the waiting-for-approval status before continuing to Home settings', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        let resolveEnrollment: ((result: PreferredDirectoryHomeEnrollmentResult) => void) | null = null;
        enrollPreferredDirectoryHomeSpy.mockImplementationOnce(async () => await new Promise((resolve) => {
            resolveEnrollment = resolve;
        }));
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalled();
            });
            replaceSpy.mockClear();
            await act(async () => {
                resolveEnrollment?.({
                    kind: 'approval_required',
                    homeServerIdentityId: 'home-b',
                    approvalId: 'approval-1',
                    expiresAtMs: now + 60_000,
                    resume: vi.fn(async () => ({ kind: 'cancelled' as const })),
                    cancel: vi.fn(async () => ({ kind: 'cancelled' as const })),
                });
            });
            await vi.waitFor(() => {
                expect(replaceSpy).toHaveBeenCalledWith('/settings/server');
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-stage-finding_homes',
                })).toBeTruthy();
                expect(tree.root.findAllByProps({
                    testID: 'oauth-account-directory-stage-waiting_approval',
                })).toHaveLength(0);
            });
        } finally {
            act(() => tree.unmount());
        }
    });

    it('keeps an unauthenticated entry requester on the approval continuation instead of authenticated Home settings', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', purpose: 'account_directory',
            credentialTarget: 'account_directory', endpointUrl: endpoint,
            endpointServerIdentityId: identity, pending: 'directory-pending', mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint, serverIdentityId: identity, credentialTarget: 'account_directory',
            // Welcome entry: this requester holds only the restricted Account Service credential
            // and has no Home credential that could reach /settings/server.
            entryIntent: 'enter_preferred_home',
            provider: 'github', purpose: 'account_directory', pending: 'directory-pending',
            createdAt: now - 100, expiresAt: now + 60_000, mode: 'keyless',
            proof: 'directory-proof', returnTo: '/',
        });
        let resolveEnrollment: ((result: PreferredDirectoryHomeEnrollmentResult) => void) | null = null;
        enrollPreferredDirectoryHomeSpy.mockImplementationOnce(async () => await new Promise((resolve) => {
            resolveEnrollment = resolve;
        }));
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalled();
            });
            replaceSpy.mockClear();
            await act(async () => {
                resolveEnrollment?.({
                    kind: 'approval_required',
                    homeServerIdentityId: 'srv_home_entry',
                    approvalId: 'approval-entry',
                    expiresAtMs: now + 60_000,
                    resume: vi.fn(async () => ({ kind: 'cancelled' as const })),
                    cancel: vi.fn(async () => ({ kind: 'cancelled' as const })),
                });
            });
            await flushOAuthEffects(8);

            // The unauthenticated journey owns the wait; routing it into authenticated Home
            // settings would strand a requester that cannot list or decide approvals there.
            expect(replaceSpy).not.toHaveBeenCalledWith('/settings/server');
            expect(tree.root.findAllByProps({
                testID: 'oauth-account-directory-approval-waiting',
            }).length).toBeGreaterThan(0);
            expect(tree.root.findByProps({
                testID: 'oauth-account-directory-approval-cancel',
            })).toBeTruthy();
            expect(setActiveServerAndSwitchSpy).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('cancels a detached approval continuation when the selected Account Service changes after redemption', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        let resolveEnrollment: ((result: PreferredDirectoryHomeEnrollmentResult) => void) | null = null;
        enrollPreferredDirectoryHomeSpy.mockImplementationOnce(async () => await new Promise((resolve) => {
            resolveEnrollment = resolve;
        }));
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);
        const cancelContinuation = vi.fn(async () => ({ kind: 'cancelled' as const }));

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => expect(enrollPreferredDirectoryHomeSpy).toHaveBeenCalled());
            const enrollmentOptions = enrollPreferredDirectoryHomeSpy.mock.calls[0]?.[1] as Readonly<{
                shouldInvalidateContinuation?: () => boolean;
            }> | undefined;
            expect(enrollmentOptions?.shouldInvalidateContinuation?.()).toBe(false);
            setAccountServiceEndpoint({
                url: 'https://other-directory.example.test',
                serverIdentityId: 'srv_directory_2',
                source: 'user',
            });
            expect(enrollmentOptions?.shouldInvalidateContinuation?.()).toBe(true);
            await act(async () => {
                resolveEnrollment?.({
                    kind: 'approval_required',
                    homeServerIdentityId: 'home-b',
                    approvalId: 'approval-service-change',
                    expiresAtMs: now + 60_000,
                    resume: vi.fn(async () => ({ kind: 'cancelled' as const })),
                    cancel: cancelContinuation,
                });
            });
            await vi.waitFor(() => expect(cancelContinuation).toHaveBeenCalledOnce());
        } finally {
            act(() => tree.unmount());
        }
    });

    it('does not report Home-added success when preferred Home enrollment fails', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        enrollPreferredDirectoryHomeSpy.mockResolvedValueOnce({ kind: 'failed' });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-error-home_enrollment_failed',
                })).toBeTruthy();
            });
            expect(replaceSpy).not.toHaveBeenCalled();
            expect(modal.alert).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('cancels only the pending Account Service attempt and reassures that existing Homes stay signed in', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        probeServerFeaturesAtUrlSpy.mockImplementationOnce(async () => {
            await new Promise<void>(() => {});
        });

        const tree = await renderOAuthReturnScreen();
        try {
            expect(tree.root.findByProps({
                testID: 'oauth-account-directory-cancel-note',
            })).toBeTruthy();
            await act(async () => {
                await tree.root.findByProps({
                    testID: 'oauth-return-wizard-secondary',
                }).props.onPress();
            });
            expect(pendingAccountDirectoryAuthClearSpy).toHaveBeenCalledWith({
                endpoint,
                serverIdentityId: identity,
            });
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('rejects an endpoint identity change before token exchange, credential persistence, or Directory work', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: 'srv_directory_1',
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: 'srv_directory_1',
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
        });
        probeServerFeaturesAtUrlSpy.mockResolvedValue({
            status: 'ready',
            serverIdentityId: 'srv_directory_2',
            features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
        });
        const fetchMock = vi.fn(async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ) => new Response(JSON.stringify({ token: 'must-not-store' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            expect(fetchMock).not.toHaveBeenCalled();
            expect({
                credentialWrites: accountDirectoryCredentialSetSpy.mock.calls,
                pendingClears: pendingAccountDirectoryAuthClearSpy.mock.calls,
            }).toEqual({ credentialWrites: [], pendingClears: [] });
            expect(createAccountDirectorySessionSpy).not.toHaveBeenCalled();
            expect(refreshAccountHomeDirectorySpy).not.toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
        });
    });

    it.each([
        ['missing', undefined],
        ['malformed', { version: 1, homeDirectory: true, homeEnrollment: true }],
        ['unsupported', { ...supportedCapability, version: 2 }],
    ])('stores the completed credential but starts no Directory work for a %s capability', async (_name, capability) => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
        });
        probeServerFeaturesAtUrlSpy.mockResolvedValueOnce({
            status: 'ready',
            serverIdentityId: identity,
            features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: capability } },
        });
        setRuntimeFetch(vi.fn(async () => new Response(JSON.stringify({ token: 'directory-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalled();
            expect(createAccountDirectorySessionSpy).not.toHaveBeenCalled();
            expect(refreshAccountHomeDirectorySpy).not.toHaveBeenCalled();
            expect(enrollPreferredDirectoryHomeSpy).not.toHaveBeenCalled();
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
        });
    });

    it('runs the real callback refresh and preferred enrollment owners for an established Home without changing focus', async () => {
        accountDirectoryComposition.useRealOwners = true;
        const credentialStoreSpy = vi.spyOn(TokenStorage, 'setCredentialsForServerUrlWithRollback');
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `oauth_directory_composed_${Date.now()}_${Math.random()}`;
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        profiles.setActiveServerId(focused.id);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: focused.id,
            groups: [{ id: 'g', name: 'Homes', serverIds: [focused.id] }],
        });
        await profiles.adoptHomeProfile({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'manual',
            descriptorAuthority: 'current_connection_observation',
            suggestedName: 'Home B',
        });
        const activeBefore = profiles.getActiveServerSnapshot();
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory';
        probeServerFeaturesAtUrlSpy.mockResolvedValue({
            status: 'ready',
            serverIdentityId: identity,
            features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
        });
        let requestedBoxPublicKeyBase64: string | null = null;
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 5 * 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        accountDirectoryCredentialGetSpy.mockResolvedValue({ token: 'directory-token' });
        const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
            const url = requestInput instanceof Request
                ? requestInput.url
                : String(requestInput);
            if (url.includes('/finalize-keyless')) {
                return new Response(JSON.stringify({ token: 'directory-token' }), { status: 200 });
            }
            if (url.endsWith('/v1/account-directory/me')) {
                return new Response(JSON.stringify({
                    v: 1,
                    accountId: 'account-1',
                    displayName: null,
                    avatar: null,
                    linkedAuthenticationMethods: [],
                }), { status: 200 });
            }
            if (url.endsWith('/v1/account-directory/homes')) {
                return new Response(JSON.stringify({
                    v: 1,
                    homes: [{
                        v: 1,
                        homeServerIdentityId: 'srv_home_b',
                        canonicalServerUrl: 'https://home-b.test',
                        label: 'Home B',
                        preferred: true,
                        connectionDescriptor: {
                            v: 1,
                            homeServerIdentityId: 'srv_home_b',
                            canonicalServerUrl: 'https://home-b.test',
                            revision: 1,
                            endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                        },
                        createdAtMs: now,
                        updatedAtMs: now,
                    }],
                    preferredHomeServerIdentityId: 'srv_home_b',
                }), { status: 200 });
            }
            if (url.includes('/login-assertion')) {
                const request = requestInput instanceof Request
                    ? requestInput.clone()
                    : new Request(requestInput, requestInit);
                const body = await request.json() as { clientBoxPublicKeyBase64?: unknown };
                if (typeof body.clientBoxPublicKeyBase64 !== 'string') {
                    throw new Error('Missing client box public key');
                }
                requestedBoxPublicKeyBase64 = body.clientBoxPublicKeyBase64;
                return new Response(JSON.stringify({
                    v: 1,
                    purpose: 'happier.home-login',
                    issuerServerIdentityId: identity,
                    issuerSubjectId: 'account-1',
                    audienceHomeServerIdentityId: 'srv_home_b',
                    credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1({
                        v: 1,
                        homeServerIdentityId: 'srv_home_b',
                        canonicalServerUrl: 'https://home-b.test',
                        revision: 1,
                        endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                    }),
                    clientBoxPublicKeyBase64: requestedBoxPublicKeyBase64,
                    issuedAtMs: now,
                    expiresAtMs: now + 2 * 60_000,
                    keyId: 'a'.repeat(64),
                    signatureBase64Url: encodeBase64(new Uint8Array(64), 'base64url'),
                }), { status: 200 });
            }
            if (url.endsWith('/v1/auth/home-login')) {
                if (!requestedBoxPublicKeyBase64) {
                    throw new Error('Home login was requested before the Directory assertion');
                }
                const sealedHomeTokenBase64Url = encodeBase64(
                    encryptBox(
                        new TextEncoder().encode(JSON.stringify({ token: 'home-b-token' })),
                        decodeBase64(requestedBoxPublicKeyBase64, 'base64'),
                    ),
                    'base64url',
                );
                return new Response(JSON.stringify({
                    v: 1,
                    homeServerIdentityId: 'srv_home_b',
                    sealedHomeTokenBase64Url,
                    issuedAtMs: now,
                    expiresAtMs: now + 2 * 60_000,
                }), { status: 200 });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        probeServerFeaturesAtUrlSpy.mockImplementation(async (...args: unknown[]) => {
            const input = args[0];
            const endpointUrl = typeof input === 'object' && input !== null && 'endpointUrl' in input
                ? String(input.endpointUrl)
                : '';
            return endpointUrl === 'https://home-b.test'
                ? {
                    status: 'ready',
                    serverIdentityId: 'srv_home_b',
                    features: {
                        capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                        homeConnectionDescriptor: {
                            v: 1,
                            homeServerIdentityId: 'srv_home_b',
                            canonicalServerUrl: 'https://home-b.test',
                            revision: 1,
                            endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                        },
                    },
                }
                : {
                    status: 'ready',
                    serverIdentityId: identity,
                    features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
                };
        });
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(20);
            expect(requestedBoxPublicKeyBase64).not.toBeNull();
            expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
                expect.stringContaining('/login-assertion'),
                expect.stringContaining('/v1/auth/home-login'),
            ]));
            expect(accountDirectoryComposition.enrollmentResult).toEqual({
                kind: 'enrolled',
                homeServerIdentityId: 'srv_home_b',
            });
            expect(profiles.listServerProfiles().filter((profile) => profile.serverIdentityId === 'srv_home_b')).toHaveLength(1);
            expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
                expect.objectContaining({ serverIdentityId: 'srv_home_b', name: 'Home B' }),
            ]));
            expect(credentialStoreSpy).toHaveBeenCalledWith(
                'https://home-b.test',
                { serverId: 'srv_home_b' },
                { token: 'home-b-token' },
            );
            expect(profiles.getActiveServerSnapshot()).toMatchObject({
                serverId: activeBefore.serverId,
                serverUrl: activeBefore.serverUrl,
            });
            expect(profiles.loadHomeViewState()).toMatchObject({
                activeTargetId: focused.id,
                groups: [{ id: 'g', serverIds: [focused.id] }],
            });
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
        });
    });

    it('runs the real callback and settings continuation through approval for an established Home', async () => {
        accountDirectoryComposition.useRealOwners = true;
        const credentialStoreSpy = vi.spyOn(TokenStorage, 'setCredentialsForServerUrlWithRollback');
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `oauth_directory_approval_${Date.now()}_${Math.random()}`;
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const enrollmentOwner = await import('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome');
        const focused = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.test',
            name: 'Home A',
            source: 'manual',
        });
        profiles.setActiveServerId(focused.id);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: focused.id,
            groups: [{ id: 'g', name: 'Homes', serverIds: [focused.id] }],
        });
        await profiles.adoptHomeProfile({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'manual',
            descriptorAuthority: 'current_connection_observation',
            suggestedName: 'Home B',
        });
        const activeBefore = profiles.getActiveServerSnapshot();
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const directoryIdentity = 'srv_directory';
        const homeIdentity = 'srv_home_b';
        const homeUrl = 'https://home-b.test';
        probeServerFeaturesAtUrlSpy.mockResolvedValue({
            status: 'ready',
            serverIdentityId: directoryIdentity,
            features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
        });
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: directoryIdentity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: directoryIdentity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 5 * 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
        });
        accountDirectoryCredentialGetSpy.mockResolvedValue({ token: 'directory-token' });

        let requestedBoxPublicKeyBase64: string | null = null;
        let homeLoginCalls = 0;
        const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
            const url = requestInput instanceof Request ? requestInput.url : String(requestInput);
            if (url.includes('/finalize-keyless')) {
                return new Response(JSON.stringify({ token: 'directory-token' }), { status: 200 });
            }
            if (url.endsWith('/v1/account-directory/me')) {
                return new Response(JSON.stringify({
                    v: 1,
                    accountId: 'account-1',
                    displayName: null,
                    avatar: null,
                    linkedAuthenticationMethods: [],
                }), { status: 200 });
            }
            if (url.endsWith('/v1/account-directory/homes')) {
                return new Response(JSON.stringify({
                    v: 1,
                    homes: [{
                        v: 1,
                        homeServerIdentityId: homeIdentity,
                        canonicalServerUrl: homeUrl,
                        label: 'Home B',
                        preferred: true,
                        connectionDescriptor: {
                            v: 1,
                            homeServerIdentityId: homeIdentity,
                            canonicalServerUrl: homeUrl,
                            revision: 1,
                            endpoints: [{ kind: 'https', url: homeUrl }],
                        },
                        createdAtMs: now,
                        updatedAtMs: now,
                    }],
                    preferredHomeServerIdentityId: homeIdentity,
                }), { status: 200 });
            }
            if (url.includes('/login-assertion')) {
                const request = requestInput instanceof Request
                    ? requestInput.clone()
                    : new Request(requestInput, requestInit);
                const body = await request.json() as { clientBoxPublicKeyBase64?: unknown };
                if (typeof body.clientBoxPublicKeyBase64 !== 'string') {
                    throw new Error('Missing client box public key');
                }
                requestedBoxPublicKeyBase64 = body.clientBoxPublicKeyBase64;
                return new Response(JSON.stringify({
                    v: 1,
                    purpose: 'happier.home-login',
                    issuerServerIdentityId: directoryIdentity,
                    issuerSubjectId: 'account-1',
                    audienceHomeServerIdentityId: homeIdentity,
                    credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1({
                        v: 1,
                        homeServerIdentityId: homeIdentity,
                        canonicalServerUrl: homeUrl,
                        revision: 1,
                        endpoints: [{ kind: 'https', url: homeUrl }],
                    }),
                    clientBoxPublicKeyBase64: requestedBoxPublicKeyBase64,
                    issuedAtMs: now,
                    expiresAtMs: now + 2 * 60_000,
                    keyId: 'a'.repeat(64),
                    signatureBase64Url: encodeBase64(new Uint8Array(64), 'base64url'),
                }), { status: 200 });
            }
            if (url.endsWith('/v1/auth/home-login')) {
                homeLoginCalls += 1;
                if (homeLoginCalls === 1) {
                    return new Response(JSON.stringify({
                        v: 1,
                        outcome: 'approval_required',
                        homeServerIdentityId: homeIdentity,
                        approvalId: 'approval-1',
                        deviceLabel: null,
                        expiresAtMs: now + 60_000,
                    }), { status: 202 });
                }
                if (!requestedBoxPublicKeyBase64) {
                    throw new Error('Home login was retried without the requester key');
                }
                const sealedHomeTokenBase64Url = encodeBase64(
                    encryptBox(
                        new TextEncoder().encode(JSON.stringify({ token: 'home-b-token' })),
                        decodeBase64(requestedBoxPublicKeyBase64, 'base64'),
                    ),
                    'base64url',
                );
                return new Response(JSON.stringify({
                    v: 1,
                    homeServerIdentityId: homeIdentity,
                    sealedHomeTokenBase64Url,
                    issuedAtMs: now,
                    expiresAtMs: now + 2 * 60_000,
                }), { status: 200 });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        probeServerFeaturesAtUrlSpy.mockImplementation(async (...args: unknown[]) => {
            const input = args[0];
            const endpointUrl = typeof input === 'object' && input !== null && 'endpointUrl' in input
                ? String(input.endpointUrl)
                : '';
            return endpointUrl === homeUrl
                ? {
                    status: 'ready',
                    serverIdentityId: homeIdentity,
                    features: {
                        capabilities: { serverIdentity: { serverIdentityId: homeIdentity } },
                        homeConnectionDescriptor: {
                            v: 1,
                            homeServerIdentityId: homeIdentity,
                            canonicalServerUrl: homeUrl,
                            revision: 1,
                            endpoints: [{ kind: 'https', url: homeUrl }],
                        },
                    },
                }
                : {
                    status: 'ready',
                    serverIdentityId: directoryIdentity,
                    features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
                };
        });
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(20);
            await vi.waitFor(() => {
                expect(accountDirectoryComposition.enrollmentResult).toMatchObject({
                    kind: 'approval_required',
                    homeServerIdentityId: homeIdentity,
                    approvalId: 'approval-1',
                });
            });
            expect(replaceSpy).toHaveBeenCalledWith('/settings/server');
            expect(enrollmentOwner.getPendingPreferredHomeEnrollment()).toMatchObject({
                kind: 'approval_required',
                homeServerIdentityId: homeIdentity,
                approvalId: 'approval-1',
            });
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
        });

        const homeB = profiles.listServerProfiles().find((profile) => (
            profile.serverIdentityId === homeIdentity
        ));
        expect(homeB).toBeTruthy();
        const { HomeDeviceApprovalSection } = await import(
            '@/components/settings/server/sections/HomeDeviceApprovalSection'
        );
        const settings = await renderScreen(<HomeDeviceApprovalSection homes={[homeB!]} />);
        try {
            await vi.waitFor(() => {
                expect(settings.findByTestId('settings.server.homeEnrollment.pending.retry')).toBeTruthy();
            });
            const retry = settings.findByTestId('settings.server.homeEnrollment.pending.retry')!;
            await act(async () => {
                retry.props.onPress();
            });
            await vi.waitFor(() => expect(homeLoginCalls).toBe(2));
            await vi.waitFor(() => expect(enrollmentOwner.getPendingPreferredHomeEnrollment()).toBeNull());
            await vi.waitFor(() => {
                expect(credentialStoreSpy).toHaveBeenCalledWith(
                    homeUrl,
                    { serverId: homeIdentity },
                    { token: 'home-b-token' },
                );
            });

            expect(homeLoginCalls).toBe(2);
            expect(enrollmentOwner.getPendingPreferredHomeEnrollment()).toBeNull();
            expect(profiles.getActiveServerSnapshot()).toMatchObject({
                serverId: activeBefore.serverId,
                serverUrl: activeBefore.serverUrl,
            });
            expect(profiles.loadHomeViewState()).toMatchObject({
                activeTargetId: focused.id,
                groups: [{ id: 'g', serverIds: [focused.id] }],
            });
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
        } finally {
            act(() => settings.tree.unmount());
        }
    });

    it('uses the existing keyed finalizer when the server selects keyed provisioning for a new Account', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyed',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyed',
            proof: 'directory-proof',
            secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        });
        const fetchMock = vi.fn(async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ) => new Response(
            JSON.stringify({ token: 'directory-token' }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            },
        ));
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            const [requestInput, requestInit] = fetchMock.mock.calls[0]!;
            const request = requestInput instanceof Request
                ? requestInput.clone()
                : new Request(requestInput, requestInit);
            expect(request.url).toContain(`${endpoint}/v1/auth/external/github/finalize`);
            expect(request.url).not.toContain('finalize-keyless');
            await expect(request.json()).resolves.toEqual({
                pending: 'directory-pending',
                proof: 'directory-proof',
                publicKey: expect.any(String),
                challenge: expect.any(String),
                signature: expect.any(String),
            });
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalledWith(
                { endpoint, serverIdentityId: identity },
                { token: 'directory-token' },
            );
            expect(loginSpy).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
        });
    });

    it('rejects a callback mode that does not match the persisted Directory continuation', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: 'srv_directory_1',
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: 'srv_directory_1',
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyed',
            proof: 'directory-proof',
            secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        });
        const fetchMock = vi.fn();
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            expect(fetchMock).not.toHaveBeenCalled();
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
            expect(pendingAccountDirectoryAuthClearSpy).toHaveBeenCalled();
        });
    });

    it.each([
        {
            name: 'purpose',
            callback: { purpose: 'account', endpointServerIdentityId: 'srv_directory_1' },
        },
        {
            name: 'endpoint identity',
            callback: { purpose: 'account_directory', endpointServerIdentityId: 'srv_directory_tampered' },
        },
    ])('rejects tampered $name before token exchange or credential storage', async ({ callback }) => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            pending: 'directory-pending',
            ...callback,
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: 'srv_directory_1',
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            proof: 'directory-proof',
        });
        const fetchMock = vi.fn();
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            expect(fetchMock).not.toHaveBeenCalled();
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
            expect(pendingAccountDirectoryAuthClearSpy).toHaveBeenCalled();
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
        });
    });

    it('resumes persisted Directory custody when callback purpose markers are stripped', async () => {
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setAccountServiceEndpoint({ url: endpoint, serverIdentityId: identity, source: 'user' });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            entryIntent: 'connect_service',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
        });
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ token: 'directory-token' }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            },
        ));
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(12);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalledWith(
                { endpoint, serverIdentityId: identity },
                { token: 'directory-token' },
            );
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
        });
    });

    it('provisions the captured authenticated Home link before Directory refresh and enrollment', async () => {
        accountDirectoryComposition.useRealOwners = true;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `oauth_home_link_${Date.now()}_${Math.random()}`;
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        probeServerFeaturesAtUrlSpy.mockResolvedValue({
            status: 'ready',
            serverIdentityId: identity,
            features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
        });
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', name: 'Home A', source: 'manual' });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: focused.id,
            groups: [{ id: 'g', name: 'Homes', serverIds: [focused.id] }],
        });
        const activeBefore = profiles.getActiveServerSnapshot();
        const homeViewStateBefore = profiles.loadHomeViewState();
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://home-a.test',
            { serverId: 'srv_home_a' },
            { token: 'home-a-token' },
        )).resolves.toBe(true);
        expect(profiles.resolveServerProfileForPortableIdentity('srv_home_a')).toMatchObject({
            kind: 'resolved',
        });
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://home-a.test',
            { serverId: 'srv_home_a' },
        )).resolves.toEqual({ token: 'home-a-token' });

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 5 * 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
            homeServerIdentityId: 'srv_home_a',
        });

        const descriptor = {
            v: 1,
            homeServerIdentityId: 'srv_home_a',
            canonicalServerUrl: 'https://home-a.test',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://home-a.test' }],
        } as const;
        const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
            const url = requestInput instanceof Request ? requestInput.url : String(requestInput);
            if (url.includes('/finalize-keyless')) {
                return new Response(JSON.stringify({ token: 'directory-token' }), { status: 200 });
            }
            if (url === `${endpoint}/v1/account-directory/me`) {
                return new Response(JSON.stringify({
                    v: 1,
                    accountId: 'account-1',
                    displayName: null,
                    avatar: null,
                    linkedAuthenticationMethods: [],
                }), { status: 200 });
            }
            if (url === `https://home-a.test/v1/account/directory-links/${identity}`) {
                return new Response(JSON.stringify({
                    v: 1,
                    issuerServerIdentityId: identity,
                    issuerSubjectId: 'account-1',
                    issuerSigningKeyId: 'a'.repeat(64),
                    issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
                }), { status: 200 });
            }
            if (url === `${endpoint}/v1/account-directory/homes/srv_home_a`) {
                return new Response(JSON.stringify({
                    v: 1,
                    homeServerIdentityId: 'srv_home_a',
                    canonicalServerUrl: 'https://home-a.test',
                    label: 'Home A',
                    preferred: true,
                    connectionDescriptor: descriptor,
                    createdAtMs: now,
                    updatedAtMs: now,
                }), { status: 200 });
            }
            if (url === `${endpoint}/v1/account-directory/homes`) {
                return new Response(JSON.stringify({ v: 1, homes: [], preferredHomeServerIdentityId: null }), { status: 200 });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects(24);
            const calls = fetchMock.mock.calls.map(([input, init]) => ({
                url: input instanceof Request ? input.url : String(input),
                init: init as RequestInit | undefined,
            }));
            expect(calls.map((call) => call.url)).toContain(`${endpoint}/v1/account-directory/me`);
            expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
                expect.stringContaining('/v1/account/directory-links/'),
            ]));
            const linkIndex = calls.findIndex((call) => call.url === `https://home-a.test/v1/account/directory-links/${identity}`);
            const publishIndex = calls.findIndex((call) => call.url === `${endpoint}/v1/account-directory/homes/srv_home_a`);
            const refreshIndex = calls.findIndex((call) => call.url === `${endpoint}/v1/account-directory/homes`);
            expect(linkIndex).toBeGreaterThanOrEqual(0);
            expect(publishIndex).toBeGreaterThan(linkIndex);
            expect(refreshIndex).toBeGreaterThan(publishIndex);

            // The Home link request authenticates with the user's full Home credential.
            const linkRequest = new Request(
                fetchMock.mock.calls[linkIndex]![0] as RequestInfo,
                fetchMock.mock.calls[linkIndex]![1] as RequestInit | undefined,
            );
            expect(linkRequest.method).toBe('PUT');
            expect(linkRequest.headers.get('authorization')).toBe('Bearer home-a-token');
            await expect(linkRequest.json()).resolves.toEqual({
                v: 1,
                issuerServerIdentityId: identity,
                issuerSubjectId: 'account-1',
                issuerSigningKeyId: 'a'.repeat(64),
                issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
                relink: false,
            });

            // Directory publication uses the canonical composed descriptor.
            const publishRequest = new Request(
                fetchMock.mock.calls[publishIndex]![0] as RequestInfo,
                fetchMock.mock.calls[publishIndex]![1] as RequestInit | undefined,
            );
            await expect(publishRequest.json()).resolves.toEqual({
                v: 1,
                label: 'Home A',
                connectionDescriptor: descriptor,
            });

            // Preferred selection stays server-owned; the client never calls setPreferredHome.
            expect(calls.some((call) => call.url.includes('/v1/account-directory/homes/preferred'))).toBe(false);

            // Login lifecycle keeps focus, groups, and Home auth untouched.
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(profiles.getActiveServerSnapshot()).toMatchObject({
                serverId: activeBefore.serverId,
                serverUrl: activeBefore.serverUrl,
            });
            expect(profiles.loadHomeViewState()).toEqual(homeViewStateBefore);
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
        });
    });

    it.each([
        ['profile', false],
        ['credentials', true],
    ] as const)('fails closed without Directory publication when the captured Home %s is unavailable', async (_name, seedHome) => {
        accountDirectoryComposition.useRealOwners = true;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `oauth_link_missing_${Date.now()}_${Math.random()}`;
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        probeServerFeaturesAtUrlSpy.mockResolvedValue({
            status: 'ready',
            serverIdentityId: identity,
            features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
        });
        if (seedHome) {
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const focused = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', name: 'Home A', source: 'manual' });
            profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
            profiles.setActiveServerId(focused.id);
        }

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 5 * 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
            homeServerIdentityId: seedHome ? 'srv_home_a' : 'srv_missing',
        });
        const fetchMock = vi.fn(async (requestInput: RequestInfo | URL) => {
            const url = requestInput instanceof Request ? requestInput.url : String(requestInput);
            if (url.includes('/finalize-keyless')) {
                return new Response(JSON.stringify({ token: 'directory-token' }), { status: 200 });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await flushOAuthEffects(24);
            const urls = fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
            expect(urls.some((url) => url.includes('/v1/account-directory'))).toBe(false);
            expect(urls.some((url) => url.includes('/v1/account/directory-links'))).toBe(false);
            // The Account Service login itself completed and stays stored.
            expect(accountDirectoryCredentialSetSpy).toHaveBeenCalledWith(
                { endpoint, serverIdentityId: identity },
                { token: 'directory-token' },
            );
            expect(tree.root.findByProps({
                testID: 'oauth-account-directory-error-home_link_failed',
            })).toBeTruthy();
            expect(modal.alert).not.toHaveBeenCalled();
            expect(replaceSpy).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('surfaces a signing-key conflict without silent relink or Directory publication', async () => {
        accountDirectoryComposition.useRealOwners = true;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `oauth_link_conflict_${Date.now()}_${Math.random()}`;
        const now = Date.now();
        const endpoint = 'https://directory.example.test';
        const identity = 'srv_directory_1';
        probeServerFeaturesAtUrlSpy.mockResolvedValue({
            status: 'ready',
            serverIdentityId: identity,
            features: { capabilities: { server: { canonicalServerUrl: endpoint }, accountDirectory: supportedCapability } },
        });
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', name: 'Home A', source: 'manual' });
        profiles.setServerProfileIdentityForUrl('https://home-a.test', 'srv_home_a');
        profiles.setActiveServerId(focused.id);
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://home-a.test',
            { serverId: 'srv_home_a' },
            { token: 'home-a-token' },
        )).resolves.toBe(true);

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: endpoint,
            endpointServerIdentityId: identity,
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setPendingAccountDirectoryAuthState({
            endpoint,
            serverIdentityId: identity,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'directory-pending',
            createdAt: now - 100,
            expiresAt: now + 5 * 60_000,
            mode: 'keyless',
            proof: 'directory-proof',
            returnTo: '/settings/account',
            homeServerIdentityId: 'srv_home_a',
        });
        const fetchMock = vi.fn(async (requestInput: RequestInfo | URL) => {
            const url = requestInput instanceof Request ? requestInput.url : String(requestInput);
            if (url.includes('/finalize-keyless')) {
                return new Response(JSON.stringify({ token: 'directory-token' }), { status: 200 });
            }
            if (url === `${endpoint}/v1/account-directory/me`) {
                return new Response(JSON.stringify({
                    v: 1,
                    accountId: 'account-1',
                    displayName: null,
                    avatar: null,
                    linkedAuthenticationMethods: [],
                }), { status: 200 });
            }
            if (url === `https://home-a.test/v1/account/directory-links/${identity}`) {
                return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 409 });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        setRuntimeFetch(fetchMock as unknown as typeof fetch);

        const tree = await renderOAuthReturnScreen();
        try {
            await flushOAuthEffects(24);
            const linkUrls = fetchMock.mock.calls
                .map(([input]) => (input instanceof Request ? input.url : String(input)))
                .filter((url) => url.includes('/v1/account/directory-links/'));
            // The conflict is surfaced once; no silent relink retry.
            expect(linkUrls).toHaveLength(1);
            const urls = fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
            expect(urls.some((url) => url.includes('/v1/account-directory/homes'))).toBe(false);
            expect(tree.root.findByProps({
                testID: 'oauth-account-directory-error-home_link_failed',
            })).toBeTruthy();
            expect(modal.alert).not.toHaveBeenCalled();
            expect(replaceSpy).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });

    it('surfaces unavailable secure custody without clearing the pending continuation', async () => {
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: 'https://directory.example.test',
            endpointServerIdentityId: 'srv_directory_1',
            pending: 'directory-pending',
            mode: 'keyless',
        });
        setAccountServiceEndpoint({
            url: 'https://directory.example.test',
            serverIdentityId: 'srv_directory_1',
            source: 'user',
        });
        pendingAccountDirectoryAuthGetSpy.mockRejectedValueOnce(
            new AccountDirectoryStorageReadError('unavailable'),
        );

        const tree = await renderOAuthReturnScreen();
        try {
            await vi.waitFor(() => {
                expect(tree.root.findByProps({
                    testID: 'oauth-account-directory-error-credential_storage_failed',
                })).toBeTruthy();
            });
            expect(pendingAccountDirectoryAuthClearSpy).not.toHaveBeenCalled();
            expect(accountDirectoryCredentialSetSpy).not.toHaveBeenCalled();
        } finally {
            act(() => tree.unmount());
        }
    });
});
