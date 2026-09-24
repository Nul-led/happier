import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WelcomeAuthenticationMethod } from '@/components/onboarding/preAuth/composeWelcomeEntryModel';

const boundary = vi.hoisted(() => ({
    request: vi.fn(),
    openUrl: vi.fn(),
    readCredentials: vi.fn(),
    setPendingAuth: vi.fn(),
    clearPendingAuth: vi.fn(),
    setPendingConnect: vi.fn(),
    clearPendingConnect: vi.fn(),
    getConnectUrl: vi.fn(),
    getExternalAuthUrl: vi.fn(),
    seedKeypair: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeNativeMock({ platformOS: 'ios' }, {
        Linking: { openURL: boundary.openUrl },
    });
});
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: vi.fn(() => boundary.request),
    serverFetch: boundary.request,
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: boundary.readCredentials,
        setPendingExternalAuth: boundary.setPendingAuth,
        clearPendingExternalAuth: boundary.clearPendingAuth,
        setPendingExternalConnect: boundary.setPendingConnect,
        clearPendingExternalConnect: boundary.clearPendingConnect,
    },
}));
vi.mock('@/auth/providers/registry', () => ({
    getAuthProvider: vi.fn(() => ({
        id: 'github',
        displayName: 'GitHub',
        getConnectUrl: boundary.getConnectUrl,
        getExternalAuthUrl: boundary.getExternalAuthUrl,
    })),
}));
vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({ createEncryptionFromAuthCredentials: vi.fn() }));
vi.mock('@/components/account/presentFirstKeyCredentialLifecycle', () => ({
    presentFirstKeyCredentialLifecycle: async (params: {
        run: () => Promise<unknown>;
        onCompleted: () => Promise<void> | void;
    }) => {
        await params.run();
        await params.onCompleted();
    },
}));
vi.mock('@/sync/ops/account/accountEncryptionFirstKeyExternalAuth', () => ({
    guardAccountEncryptionFirstKeyCredentialMutation: vi.fn(async () => ({ kind: 'allowed' as const })),
}));
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
vi.mock('@/encryption/libsodium.lib', () => ({ default: { crypto_sign_seed_keypair: boundary.seedKeypair } }));
vi.mock('@/platform/cryptoRandom', () => ({ getRandomBytesAsync: async (size: number) => new Uint8Array(size) }));
vi.mock('@/platform/digest', () => ({ digest: async () => new Uint8Array(32) }));

const target = {
    kind: 'descriptor' as const,
    authority: 'trusted_enrollment' as const,
    descriptor: {
        v: 1 as const,
        homeServerIdentityId: 'home-team',
        canonicalServerUrl: 'https://home.example.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://edge.example.test' }],
    },
};

const request = {
    method: { id: 'github', enabledActions: [{ id: 'provision', mode: 'keyed' }] },
    action: { id: 'provision', mode: 'keyed' },
    execution: { kind: 'oauth' as const, providerId: 'github', mode: 'keyed' as const },
    authority: { purpose: 'home' as const, target },
    intendedHome: target,
} satisfies WelcomeAuthenticationMethod;

describe('executeHomeAuthentication Team admission for a signed-in Account', () => {
    beforeEach(() => {
        for (const spy of Object.values(boundary)) spy.mockReset();
        boundary.openUrl.mockResolvedValue(undefined);
        boundary.setPendingAuth.mockResolvedValue(true);
        boundary.clearPendingAuth.mockResolvedValue(true);
        boundary.setPendingConnect.mockResolvedValue(true);
        boundary.clearPendingConnect.mockResolvedValue(true);
        boundary.seedKeypair.mockReturnValue({ publicKey: new Uint8Array(32) });
        boundary.getConnectUrl.mockResolvedValue({
            url: 'https://github.example.test/authorize?state=connect',
            purpose: 'team_admission',
            teamId: 'team-1',
            admissionReference: 'connect-attempt-1',
        });
        boundary.getExternalAuthUrl.mockResolvedValue({
            url: 'https://github.example.test/authorize?state=provision',
            purpose: 'team_admission',
            teamId: 'team-1',
            admissionReference: 'provision-attempt-1',
        });
    });

    it('links the Team identity to the Account this device already holds instead of minting a keypair', async () => {
        boundary.readCredentials.mockResolvedValue({ token: 'existing-account-token' });
        const { executeHomeAuthentication } = await import('./executeHomeAuthentication');
        const onExternalAuthStarted = vi.fn();

        await executeHomeAuthentication({
            request,
            loginWithCredentials: vi.fn(),
            returnTo: '/teams/team-1/sign-in?target=home-team',
            teamAdmission: { teamId: 'team-1', origin: 'team' },
            onAuthenticated: vi.fn(),
            onExternalAuthStarted,
        });

        expect(boundary.readCredentials).toHaveBeenCalledWith(
            'https://home.example.test',
            { serverId: 'home-team' },
        );
        expect(boundary.getConnectUrl).toHaveBeenCalledWith(
            { token: 'existing-account-token' },
            expect.objectContaining({ purpose: 'team_admission', teamId: 'team-1', origin: 'team' }),
        );
        // The continuation is bound to the exact Home whose credential started it,
        // never to whichever Home happens to be focused when the browser returns.
        expect(boundary.setPendingConnect).toHaveBeenCalledWith({
            provider: 'github',
            returnTo: '/teams/team-1/sign-in?target=home-team',
            serverUrl: 'https://home.example.test',
            serverId: 'home-team',
        });
        expect(boundary.openUrl).toHaveBeenCalledWith('https://github.example.test/authorize?state=connect');
        expect(onExternalAuthStarted).toHaveBeenCalledTimes(1);
        // The provisioning start is what drops the signed-in Account: its fresh seed
        // becomes a new `Account.publicKey`.
        expect(boundary.seedKeypair).not.toHaveBeenCalled();
        expect(boundary.getExternalAuthUrl).not.toHaveBeenCalled();
        expect(boundary.setPendingAuth).not.toHaveBeenCalled();
    });

    it('keeps the provisioning start for a device with no credential on that Home', async () => {
        boundary.readCredentials.mockResolvedValue(null);
        const { executeHomeAuthentication } = await import('./executeHomeAuthentication');

        await executeHomeAuthentication({
            request,
            loginWithCredentials: vi.fn(),
            returnTo: '/teams/team-1/sign-in?target=home-team',
            teamAdmission: { teamId: 'team-1', origin: 'team' },
            onAuthenticated: vi.fn(),
        });

        expect(boundary.getConnectUrl).not.toHaveBeenCalled();
        expect(boundary.setPendingConnect).not.toHaveBeenCalled();
        expect(boundary.getExternalAuthUrl).toHaveBeenCalledTimes(1);
        expect(boundary.seedKeypair).toHaveBeenCalledTimes(1);
        expect(boundary.openUrl).toHaveBeenCalledWith('https://github.example.test/authorize?state=provision');
    });
});
