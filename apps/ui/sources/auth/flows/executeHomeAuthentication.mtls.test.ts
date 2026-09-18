import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    request: vi.fn(),
    openUrl: vi.fn(),
    setPending: vi.fn(),
    clearPending: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeNativeMock({ platformOS: 'ios' }, {
        Linking: { openURL: boundary.openUrl },
    });
});
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: vi.fn(() => boundary.request),
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        setPendingExternalAuth: boundary.setPending,
        clearPendingExternalAuth: boundary.clearPending,
    },
}));
vi.mock('@/auth/providers/registry', () => ({ getAuthProvider: vi.fn(() => null) }));
vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({ createEncryptionFromAuthCredentials: vi.fn() }));
vi.mock('@/components/account/presentFirstKeyCredentialLifecycle', () => ({ presentFirstKeyCredentialLifecycle: vi.fn() }));
vi.mock('@/sync/ops/account/accountEncryptionFirstKeyExternalAuth', () => ({
    guardAccountEncryptionFirstKeyCredentialMutation: vi.fn(),
}));
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
vi.mock('@/encryption/libsodium.lib', () => ({ default: { crypto_sign_seed_keypair: vi.fn() } }));

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

describe('executeHomeAuthentication native mTLS', () => {
    beforeEach(() => {
        boundary.request.mockReset();
        boundary.openUrl.mockReset();
        boundary.setPending.mockReset();
        boundary.clearPending.mockReset();
        boundary.request.mockResolvedValue(new Response(JSON.stringify({
            startUrl: '/v1/auth/mtls/start/browser?reference=opaque',
            admissionReference: 'mtls-admission-1',
        }), { status: 200 }));
        boundary.setPending.mockResolvedValue(true);
        boundary.clearPending.mockResolvedValue(true);
        boundary.openUrl.mockResolvedValue(undefined);
    });

    it('prepares Team mTLS, stores only opaque Team custody, and opens the safe server URL', async () => {
        const { executeHomeAuthentication } = await import('./executeHomeAuthentication');
        const onExternalAuthStarted = vi.fn();

        await executeHomeAuthentication({
            request: {
                method: { id: 'mtls', enabledActions: [{ id: 'login', mode: 'keyless' }] },
                action: { id: 'login', mode: 'keyless' },
                execution: { kind: 'mtls' },
                authority: { purpose: 'home', target },
                intendedHome: target,
            },
            loginWithCredentials: vi.fn(),
            returnTo: '/teams/team-1/sign-in?target=home-team',
            teamAdmission: { teamId: 'team-1', invitationToken: 'invitation-secret', origin: 'home' },
            onAuthenticated: vi.fn(),
            onExternalAuthStarted,
        });

        expect(boundary.request).toHaveBeenCalledWith('/v1/auth/mtls/start', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
                returnTo: 'happier:///mtls',
                teamId: 'team-1',
                admission: { kind: 'team_invitation', token: 'invitation-secret' },
            }),
        }), { includeAuth: false, retry: 'none' });
        expect(boundary.setPending).toHaveBeenCalledWith({
            provider: 'mtls',
            serverId: 'home-team',
            serverUrl: 'https://edge.example.test',
            teamContinuation: {
                v: 1,
                purpose: 'team_admission',
                admissionReference: 'mtls-admission-1',
                teamId: 'team-1',
                homeServerIdentityId: 'home-team',
                destination: { kind: 'team_sign_in', teamId: 'team-1' },
            },
        }, { serverId: 'home-team', serverUrl: 'https://edge.example.test' });
        expect(JSON.stringify(boundary.setPending.mock.calls)).not.toContain('invitation-secret');
        expect(boundary.openUrl).toHaveBeenCalledWith('https://edge.example.test/v1/auth/mtls/start/browser?reference=opaque');
        expect(onExternalAuthStarted).toHaveBeenCalledTimes(1);
    });

    it('keeps ordinary Home mTLS on the released GET start contract', async () => {
        const { executeHomeAuthentication } = await import('./executeHomeAuthentication');

        await executeHomeAuthentication({
            request: {
                method: { id: 'mtls', enabledActions: [{ id: 'login', mode: 'keyless' }] },
                action: { id: 'login', mode: 'keyless' },
                execution: { kind: 'mtls' },
                authority: { purpose: 'home', target },
                intendedHome: target,
            },
            loginWithCredentials: vi.fn(),
            returnTo: '/setup/wizard',
            onAuthenticated: vi.fn(),
        });

        expect(boundary.request).not.toHaveBeenCalled();
        expect(boundary.setPending).toHaveBeenCalledWith({
            provider: 'mtls',
            serverId: 'home-team',
            serverUrl: 'https://edge.example.test',
            returnTo: '/setup/wizard',
        }, { serverId: 'home-team', serverUrl: 'https://edge.example.test' });
        expect(boundary.openUrl).toHaveBeenCalledWith(
            'https://edge.example.test/v1/auth/mtls/start?returnTo=happier%3A%2F%2F%2Fmtls',
        );
    });
});
