import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { useManagedIdentityProviders } from './useManagedIdentityProviders';

const serverFetchMock = vi.hoisted(() => vi.fn());
const runtimeFetchMock = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    serverFetch: serverFetchMock,
    createServerFetchAtEndpoint: () => async (path: string) => {
        if (path.startsWith('/v1/account/encryption')) {
            return new Response(JSON.stringify({ mode: 'plain', updatedAt: 0 }), { status: 200 });
        }
        if (path.startsWith('/v2/account/settings')) {
            return new Response(JSON.stringify({ content: null, version: 0 }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    },
}));
vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: runtimeFetchMock,
}));
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: { getCredentialsForServerUrl: getCredentialsForServerUrlMock },
    });
});

import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';

import { createManagedIdentityProviderClient } from './managedIdentityProviderClient';
import { resetScopedHomeActionExecutorsForTests } from '@/sync/ops/actions/scopedHomeActionExecutor';

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub }))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    return `e30.${payload}.signature`;
}

beforeEach(() => {
    runtimeFetchMock.mockReset();
    serverFetchMock.mockReset();
    getCredentialsForServerUrlMock.mockReset();
    getCredentialsForServerUrlMock.mockResolvedValue({ token: tokenForSub('account-1') });
    resetScopedHomeActionExecutorsForTests();
});

afterEach(() => {
    standardCleanup();
    resetScopedHomeActionExecutorsForTests();
    vi.clearAllMocks();
});

describe('createManagedIdentityProviderClient', () => {
    it('does not retain another owner’s projection when the mounted query changes Team', async () => {
        const serverId = (await upsertServerProfile({ serverUrl: 'https://home-provider-scope.example', name: 'Scope Home' })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        runtimeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], unreadableCount: 3 }), { status: 200 }));
        const hook = await renderHook((teamId: string) => useManagedIdentityProviders(scope, { kind: 'team', teamId }), { initialProps: 'team-1' });
        await vi.waitFor(() => expect(hook.getCurrent().state.kind).toBe('ready'));
        runtimeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));

        await hook.rerender('team-2');

        await vi.waitFor(() => expect(hook.getCurrent().state.kind).toBe('unavailable'));
    });
    it('lists Home-owned providers through the Action-declared exact Home route', async () => {
        const serverId = (await upsertServerProfile({
            serverUrl: 'https://home-provider.example',
            name: 'Provider Home',
        })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [], unreadableCount: 0 }), { status: 200 }));

        const result = await createManagedIdentityProviderClient(scope).execute(
            'identity.providers.list',
            { owner: { kind: 'home' } },
        );

        expect(result).toEqual({ kind: 'succeeded', value: { items: [], unreadableCount: 0 } });
        const request = runtimeFetchMock.mock.calls[0]?.[0];
        expect(request?.url).toBe('https://home-provider.example/v1/identity/providers/list');
        expect(request?.init?.method).toBe('POST');
        expect(JSON.parse(request?.init?.body ?? 'null')).toEqual({ owner: { kind: 'home' } });
        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('reads fresh removal impact through the canonical public Action', async () => {
        const serverId = (await upsertServerProfile({
            serverUrl: 'https://home-provider-impact.example',
            name: 'Provider Home',
        })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            provider: {
                v: 1,
                owner: { kind: 'home' },
                id: 'provider/1',
                kind: 'oidc',
                displayName: 'Corporate OIDC',
                enabled: false,
                firstEnabledAt: null,
                securityRevision: 1,
                revision: 2,
                config: {
                    v: 1,
                    kind: 'oidc',
                    issuer: 'https://id.example',
                    clientId: 'client',
                    scopes: 'openid',
                    httpTimeoutSeconds: 15,
                    claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
                    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                    fetchUserInfo: true,
                    storeRefreshToken: false,
                    ui: { buttonColor: null, iconHint: null },
                },
                secret: { configured: true, health: 'configured' },
                lastSuccessfulTest: null,
                createdByAccountId: 'account-1',
                createdAt: 1,
                updatedAt: 2,
            },
            canRemove: false,
            blockers: { identityCount: 2, connectionCount: 1, affectedAccountIds: ['account-2'] },
        }), { status: 200 }));

        const result = await createManagedIdentityProviderClient(scope).execute(
            'identity.providers.remove.preview',
            { owner: { kind: 'home' }, id: 'provider/1', expectedRevision: 2 },
        );

        expect(result.kind).toBe('succeeded');
        const request = runtimeFetchMock.mock.calls[0]?.[0];
        expect(request?.url).toBe('https://home-provider-impact.example/v1/identity/providers/remove/preflight');
        expect(request?.init?.method).toBe('POST');
        expect(JSON.parse(request?.init?.body ?? 'null')).toEqual({
            owner: { kind: 'home' }, id: 'provider/1', expectedRevision: 2,
        });
    });

    it('surfaces an ambiguous managed-provider mutation response loss as outcome unknown', async () => {
        const serverId = (await upsertServerProfile({
            serverUrl: 'https://home-provider-unknown.example',
            name: 'Provider Home',
        })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        runtimeFetchMock.mockImplementation(async (request) => {
            request.onIssued?.();
            throw Object.assign(new Error('connection reset after dispatch'), { code: 'ECONNRESET' });
        });

        const result = await createManagedIdentityProviderClient(scope).execute(
            'identity.providers.disable',
            { owner: { kind: 'home' }, id: 'provider-1', expectedRevision: 2, expectedSecurityRevision: 1 },
        );

        expect(result).toEqual({
            kind: 'failed',
            failure: { code: 'outcome_unknown', retryable: false },
        });
    });
});
