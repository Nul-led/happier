import { afterEach, describe, expect, it, vi } from 'vitest';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn(() => endpointFetchMock));
const directoryCredentialGetMock = vi.hoisted(() => vi.fn(async () => ({ token: 'directory-token' })));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: createServerFetchAtEndpointMock,
}));
vi.mock('@/auth/accountDirectory/accountDirectoryCredentialStorage', () => ({
    normalizeAccountDirectoryEndpoint: (value: string) => value.replace(/\/$/, ''),
    accountDirectoryCredentialStorage: { get: directoryCredentialGetMock },
}));

const activeSnapshotMock = vi.hoisted(() => vi.fn(() => ({ serverId: 'focused', serverUrl: 'https://focused.test', generation: 1 })));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: activeSnapshotMock }));

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('account directory client', () => {
    afterEach(() => {
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockReset();
        createServerFetchAtEndpointMock.mockImplementation(() => endpointFetchMock);
        activeSnapshotMock.mockClear();
        directoryCredentialGetMock.mockClear();
        vi.resetModules();
    });

    it('scopes credential lookup and transport to the selected Account Service identity', async () => {
        endpointFetchMock.mockResolvedValue(json({ v: 1, homes: [], preferredHomeServerIdentityId: null }));
        const { createAccountDirectoryClient } = await import('./accountDirectoryClient');
        const client = createAccountDirectoryClient({
            endpoint: 'https://directory.test',
            serverIdentityId: 'directory-new',
        });

        await client.listHomes();

        expect(directoryCredentialGetMock).toHaveBeenCalledWith({
            endpoint: 'https://directory.test',
            serverIdentityId: 'directory-new',
        });
        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith({
            endpointUrl: 'https://directory.test',
            serverId: 'directory-new',
            credentials: { token: 'directory-token' },
        });
    });

    it('targets the supplied Account Service endpoint and does not read focused Home state', async () => {
        endpointFetchMock.mockResolvedValue(json({ v: 1, homes: [], preferredHomeServerIdentityId: null }));
        const { createAccountDirectoryClient } = await import('./accountDirectoryClient');
        const client = createAccountDirectoryClient({ endpoint: 'https://directory.test/' });
        await expect(client.listHomes()).resolves.toEqual({ v: 1, homes: [], preferredHomeServerIdentityId: null });
        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith({
            endpointUrl: 'https://directory.test',
            credentials: { token: 'directory-token' },
        });
        const requestInit = endpointFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(new Headers(requestInit.headers).get('Authorization')).toBeNull();
        expect(endpointFetchMock.mock.calls[0]?.[0]).toBe('/v1/account-directory/homes');
        expect(endpointFetchMock.mock.calls[0]?.[2]).toEqual({ includeAuth: true, retry: 'none' });
        expect(activeSnapshotMock).not.toHaveBeenCalled();
    });

    it('sends the strict versioned body required by directory deletion', async () => {
        endpointFetchMock.mockResolvedValue(json({
            v: 1,
            deleted: true,
            homeServerIdentityId: 'srv_home1',
            preferredHomeServerIdentityId: null,
        }));
        const { createAccountDirectoryClient } = await import('./accountDirectoryClient');
        await createAccountDirectoryClient({ endpoint: 'https://directory.test' }).deleteHome('srv_home1');

        const init = endpointFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(init.method).toBe('DELETE');
        expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
        expect(JSON.parse(String(init.body))).toEqual({ v: 1 });
    });

    it('accepts only protocol-owned error codes from Account Directory responses', async () => {
        const { AccountDirectoryRequestError, createAccountDirectoryClient } = await import('./accountDirectoryClient');
        const client = createAccountDirectoryClient({ endpoint: 'https://directory.test' });

        endpointFetchMock.mockResolvedValueOnce(json({ error: 'assertion_expired' }, 401));
        await expect(client.listHomes()).rejects.toMatchObject({
            name: 'AccountDirectoryRequestError',
            code: 'assertion_expired',
        });

        endpointFetchMock.mockResolvedValueOnce(json({ error: 'attacker_controlled_expired' }, 401));
        try {
            await client.listHomes();
            throw new Error('Expected request failure');
        } catch (error) {
            expect(error).toBeInstanceOf(AccountDirectoryRequestError);
            expect((error as InstanceType<typeof AccountDirectoryRequestError>).code).toBeUndefined();
        }
    });

    it('redeems against the selected runtime origin while retaining canonical Home identity', async () => {
        endpointFetchMock.mockResolvedValue(json({ v: 1, homeServerIdentityId: 'srv_home1', sealedHomeTokenBase64Url: 'A'.repeat(43), issuedAtMs: 1, expiresAtMs: 120001 }));
        const { redeemHomeLoginAssertion } = await import('./accountDirectoryClient');
        const { resolveHomeEnrollmentTransport } = await import('@/auth/enrollment/homeEnrollmentTransport');
        const resolved = await resolveHomeEnrollmentTransport({
            v: 1,
            canonicalServerUrl: 'https://home.internal.test',
            homeServerIdentityId: 'srv_home1',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://home.internal.test' }],
        }, { runtimeOrigin: 'https://public.home.test' });
        if (!resolved.ok) throw new Error('Expected Home transport');
        await redeemHomeLoginAssertion(resolved.transport, {
            v: 1,
            purpose: 'happier.home-login',
            issuerServerIdentityId: 'srv_dir1',
            issuerSubjectId: 'account-1',
            audienceHomeServerIdentityId: 'srv_home1',
            clientBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            issuedAtMs: 1,
            expiresAtMs: 120001,
            keyId: 'a'.repeat(64),
            signatureBase64Url: 'A'.repeat(86),
        });
        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith({
            endpointUrl: 'https://home.internal.test',
            runtimeOrigin: 'https://public.home.test',
            serverId: 'srv_home1',
            credentials: null,
        });
        const init = endpointFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(new Headers(init.headers).get('Authorization')).toBeNull();
        expect(endpointFetchMock.mock.calls[0]?.[2]).toEqual({ includeAuth: false, retry: 'none' });
    });

    it('puts the Home directory link through the Home transport with full Home credentials and no relink', async () => {
        endpointFetchMock.mockResolvedValue(json({
            v: 1,
            issuerServerIdentityId: 'srv_dir1',
            issuerSubjectId: 'account-1',
            issuerSigningKeyId: 'a'.repeat(64),
            issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
        }));
        const { putHomeDirectoryLink } = await import('./accountDirectoryClient');
        const { resolveHomeEnrollmentTransport } = await import('@/auth/enrollment/homeEnrollmentTransport');
        const resolved = await resolveHomeEnrollmentTransport({
            v: 1,
            canonicalServerUrl: 'https://home.internal.test',
            homeServerIdentityId: 'srv_home1',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://home.internal.test' }],
        });
        if (!resolved.ok) throw new Error('Expected Home transport');
        await putHomeDirectoryLink(resolved.transport, {
            issuerServerIdentityId: 'srv_dir1',
            issuerSubjectId: 'account-1',
            issuerSigningKeyId: 'a'.repeat(64),
            issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
        }, { credentials: { token: 'home-token' } });

        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith({
            endpointUrl: 'https://home.internal.test',
            runtimeOrigin: 'https://home.internal.test',
            serverId: 'srv_home1',
            credentials: { token: 'home-token' },
        });
        expect(endpointFetchMock.mock.calls[0]?.[0]).toBe('/v1/account/directory-links/srv_dir1');
        const init = endpointFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(init.method).toBe('PUT');
        expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
        expect(JSON.parse(String(init.body))).toEqual({
            v: 1,
            issuerServerIdentityId: 'srv_dir1',
            issuerSubjectId: 'account-1',
            issuerSigningKeyId: 'a'.repeat(64),
            issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
            relink: false,
        });
        expect(endpointFetchMock.mock.calls[0]?.[2]).toEqual({ includeAuth: true, retry: 'none' });
    });

    it('sends relink only when an explicit caller opts into replacing pinned Home trust', async () => {
        endpointFetchMock.mockResolvedValue(json({
            v: 1,
            issuerServerIdentityId: 'srv_dir1',
            issuerSubjectId: 'account-1',
            issuerSigningKeyId: 'a'.repeat(64),
            issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
        }));
        const { putHomeDirectoryLink } = await import('./accountDirectoryClient');
        const { resolveHomeEnrollmentTransport } = await import('@/auth/enrollment/homeEnrollmentTransport');
        const resolved = await resolveHomeEnrollmentTransport({
            v: 1,
            canonicalServerUrl: 'https://home.internal.test',
            homeServerIdentityId: 'srv_home1',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://home.internal.test' }],
        });
        if (!resolved.ok) throw new Error('Expected Home transport');

        await putHomeDirectoryLink(resolved.transport, {
            issuerServerIdentityId: 'srv_dir1',
            issuerSubjectId: 'account-1',
            issuerSigningKeyId: 'a'.repeat(64),
            issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
        }, { credentials: { token: 'home-token' }, relink: true });

        const init = endpointFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ relink: true }));
    });

    it('classifies only the exact Home link conflict as requiring explicit relink', async () => {
        const {
            AccountDirectoryRequestError,
            isAccountDirectoryRelinkConflict,
        } = await import('./accountDirectoryClient');

        expect(isAccountDirectoryRelinkConflict(
            new AccountDirectoryRequestError(409, 'invalid_request'),
        )).toBe(true);
        expect(isAccountDirectoryRelinkConflict(
            new AccountDirectoryRequestError(400, 'invalid_request'),
        )).toBe(false);
        expect(isAccountDirectoryRelinkConflict(
            new AccountDirectoryRequestError(409, 'directory_link_not_found'),
        )).toBe(false);
        expect(isAccountDirectoryRelinkConflict(new Error('conflict'))).toBe(false);
    });

    it('rejects unknown descriptor fields and overlong assertion windows', async () => {
        const { HomeConnectionDescriptorV1Schema, HomeLoginAssertionV1Schema } = await import('./accountDirectoryClient');
        expect(HomeConnectionDescriptorV1Schema.safeParse({
            v: 1,
            homeServerIdentityId: 'home-1',
            canonicalServerUrl: 'https://home.test',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://home.test' }],
            unexpected: true,
        }).success).toBe(false);
        expect(HomeLoginAssertionV1Schema.safeParse({
            v: 1, purpose: 'happier.home-login', issuerServerIdentityId: 'd', issuerSubjectId: 'a',
            audienceHomeServerIdentityId: 'srv_h', clientBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', issuedAtMs: 0,
            expiresAtMs: 11 * 60 * 1000, keyId: 'kid', signatureBase64Url: 'sig',
        }).success).toBe(false);
    });
});
