import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: { getCredentialsForServerUrl: getCredentialsForServerUrlMock },
    });
});

import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';

import { createManagedGitHubAppsClient } from './managedGitHubAppsClient';
import { resetScopedHomeActionExecutorsForTests } from '@/sync/ops/actions/scopedHomeActionExecutor';

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub }))
        .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
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
    resetScopedHomeActionExecutorsForTests();
    vi.clearAllMocks();
});

describe('createManagedGitHubAppsClient', () => {
    it('rejects a non-canonical GitHub App Action input before transport', async () => {
        const serverId = (await upsertServerProfile({
            serverUrl: 'https://github-app-invalid.example',
            name: 'GitHub App Home',
        })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        const inputWithUnknownField = Object.assign(
            { owner: { kind: 'home' as const } },
            { unexpected: true },
        );

        const result = await createManagedGitHubAppsClient(scope).execute(
            'identity.githubApps.list',
            inputWithUnknownField,
        );

        expect(result).toEqual({
            kind: 'failed',
            failure: { code: 'invalid_parameters', retryable: false },
        });
        expect(runtimeFetchMock).not.toHaveBeenCalled();
    });

    it('lists Home-owned GitHub Apps through the Action-declared scoped route', async () => {
        const serverId = (await upsertServerProfile({
            serverUrl: 'https://github-app-home.example',
            name: 'GitHub App Home',
        })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            registrations: [],
            installations: [],
        }), { status: 200 }));

        const result = await createManagedGitHubAppsClient(scope).execute(
            'identity.githubApps.list',
            { owner: { kind: 'home' } },
        );

        expect(result).toEqual({ kind: 'succeeded', value: { registrations: [], installations: [] } });
        const request = runtimeFetchMock.mock.calls[0]?.[0];
        expect(request?.url).toBe('https://github-app-home.example/v1/identity/github-apps/list');
        expect(request?.init?.method).toBe('POST');
        expect(JSON.parse(request?.init?.body ?? 'null')).toEqual({ owner: { kind: 'home' } });
        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('preserves a GitHub removal blocker code from the Home', async () => {
        const serverId = (await upsertServerProfile({
            serverUrl: 'https://github-app-blocked.example',
            name: 'GitHub App Home',
        })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            error: 'github_installation_in_use',
            blockers: { identityProviderInstances: 2, directorySources: 1 },
        }), { status: 409 }));

        const result = await createManagedGitHubAppsClient(scope).execute(
            'identity.githubApps.remove',
            { owner: { kind: 'home' }, installationId: 'installation-1', expectedRevision: 3 },
        );

        expect(result).toEqual({
            kind: 'failed',
            failure: { code: 'github_installation_in_use', retryable: false },
        });
    });

    it('surfaces an ambiguous GitHub App mutation response loss as outcome unknown', async () => {
        const serverId = (await upsertServerProfile({
            serverUrl: 'https://github-app-unknown.example',
            name: 'GitHub App Home',
        })).id;
        const scope = createServerAccountScope(serverId, 'account-1')!;
        runtimeFetchMock.mockImplementation(async (request) => {
            request.onIssued?.();
            throw Object.assign(new Error('connection reset after dispatch'), { code: 'ECONNRESET' });
        });

        const result = await createManagedGitHubAppsClient(scope).execute(
            'identity.githubApps.remove',
            { owner: { kind: 'home' }, installationId: 'installation-1', expectedRevision: 3 },
        );

        expect(result).toEqual({
            kind: 'failed',
            failure: { code: 'outcome_unknown', retryable: false },
        });
    });
});
