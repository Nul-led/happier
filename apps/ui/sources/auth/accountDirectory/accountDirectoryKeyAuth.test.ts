import { describe, expect, it, vi } from 'vitest';
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
const generatedSecret = vi.hoisted(() => new Uint8Array(32).fill(9));
const getRandomBytesAsync = vi.hoisted(() => vi.fn(async () => generatedSecret.slice()));
vi.mock('@/platform/cryptoRandom', () => ({ getRandomBytesAsync }));
import { authenticateSelectedAccountServiceWithGeneratedKey, authenticateSelectedAccountServiceWithKey } from './accountDirectoryKeyAuth';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/sync/http/client', () => ({ createServerFetchAtEndpoint: () => request, serverFetch: request }));

const service = {
    endpointUrl: 'https://directory.test', canonicalServerUrl: 'https://directory.test', serverIdentityId: 'srv_directory',
    capability: { version: 1 as const, homeDirectory: true, homeEnrollment: true, homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) } },
    snapshot: { status: 'ready' as const, features: createRootLayoutFeaturesResponse() },
};

describe('supplied Account key operation', () => {
    it('preserves the server relink conflict rather than offering generic authentication retry', async () => {
        const { service } = createDirectoryHttpFixture();
        request.mockImplementation(async (path: string) => {
            if (path === '/v1/auth/account-directory/challenge') return new Response(JSON.stringify({
                challengeId: 'directory-challenge', nonce: 'nonce', issuedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                audience: { origin: service.canonicalServerUrl, serverIdentityId: service.serverIdentityId },
            }));
            if (path === '/v1/auth/account-directory') return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 409 });
            throw new Error(`Unexpected key request ${path}`);
        });
        expect(await authenticateSelectedAccountServiceWithKey({ service, secret: new Uint8Array(32).fill(7) }))
            .toMatchObject({ kind: 'relink_required', error: { status: 409, code: 'invalid_request' } });
    });
    it('rejects malformed supplied material locally rather than probing or prompting for another key', async () => {
        expect(await authenticateSelectedAccountServiceWithKey({ service, secret: new Uint8Array(12) })).toEqual({ kind: 'invalid_key' });
    });
    it('does no ceremony for an already aborted form submission', async () => {
        const abort = new AbortController();
        abort.abort();
        expect(await authenticateSelectedAccountServiceWithKey({ service, secret: new Uint8Array(32), signal: abort.signal })).toEqual({ kind: 'cancelled' });
    });
    it('preserves relink recovery when a generated key is rejected by the exact authority', async () => {
        const { service } = createDirectoryHttpFixture();
        request.mockImplementation(async (path: string) => {
            if (path === '/v1/auth/account-directory/challenge') return new Response(JSON.stringify({
                challengeId: 'directory-challenge', nonce: 'nonce', issuedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                audience: { origin: service.canonicalServerUrl, serverIdentityId: service.serverIdentityId },
            }));
            if (path === '/v1/auth/account-directory') return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 409 });
            throw new Error(`Unexpected key request ${path}`);
        });

        await expect(authenticateSelectedAccountServiceWithGeneratedKey({ service }))
            .resolves.toMatchObject({ kind: 'relink_required', error: { status: 409, code: 'invalid_request' } });

        expect(getRandomBytesAsync).toHaveBeenCalledWith(32);
        expect(request).toHaveBeenCalledWith('/v1/auth/account-directory/challenge', expect.anything(), expect.anything());
    });

});
