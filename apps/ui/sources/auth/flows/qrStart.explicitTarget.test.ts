import { afterEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import { authQRStart, generateAuthKeyPair } from './qrStart';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn<(input: unknown) => typeof endpointFetchMock>(() => endpointFetchMock));
const serverFetchMock = vi.hoisted(() => vi.fn());
const irohReleaseMock = vi.hoisted(() => vi.fn(async () => {}));
const acquireIrohHomeRuntimeOriginMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
    leaseId: 'qr-iroh-lease',
    runtimeOrigin: 'http://127.0.0.1:45992',
    release: irohReleaseMock,
})));

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (input: unknown) => createServerFetchAtEndpointMock(input),
    serverFetch: (...args: unknown[]) => serverFetchMock(...args),
}));
vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireIrohHomeRuntimeOriginMock(input),
}));

describe('authQRStart explicit target', () => {
    const descriptor = {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
    };
    const enrollmentTarget = async (endpointUrl: string, serverId?: string) => {
        const resolved = await resolveHomeEnrollmentTransport(descriptor);
        if (!resolved.ok) throw new Error('Expected test Home transport');
        return { ...resolved.transport, endpointUrl, ...(serverId ? { serverId } : {}) };
    };
    afterEach(() => {
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockClear();
        createServerFetchAtEndpointMock.mockImplementation(() => endpointFetchMock);
        serverFetchMock.mockReset();
        acquireIrohHomeRuntimeOriginMock.mockClear();
        irohReleaseMock.mockClear();
    });

    it('generates an X25519 public key from the retained secret scalar', () => {
        const keypair = generateAuthKeyPair();
        expect(keypair.secretKey).toHaveLength(tweetnacl.box.secretKeyLength);
        expect(keypair.publicKey).toEqual(tweetnacl.box.keyPair.fromSecretKey(keypair.secretKey).publicKey);
    });

    it('sends the enrollment request to the explicit Home endpoint without consulting the active server', async () => {
        endpointFetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        const controller = new AbortController();

        await expect(authQRStart(
            generateAuthKeyPair(),
            await enrollmentTarget('https://home-b.test', 'profile-b'),
            { signal: controller.signal },
        )).resolves.toBe(true);

        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://home-b.test',
            serverId: 'profile-b',
            credentials: null,
        }));
        expect(endpointFetchMock.mock.calls[0]?.[0]).toBe('/v2/auth/account/request');
        const init = endpointFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(init.signal).toBe(controller.signal);
        expect(JSON.parse(String(init.body))).toEqual({
            publicKey: expect.any(String),
        });
        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('reports failure without retrying through the active-server wrapper', async () => {
        endpointFetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

        await expect(authQRStart(generateAuthKeyPair(), await enrollmentTarget('https://home-b.test'))).resolves.toBe(false);

        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('uses the shared enrollment owner for a pure-Iroh QR target and releases it terminally', async () => {
        endpointFetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        const pureIroh = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 3,
            endpoints: [{ kind: 'iroh', endpointId: 'iroh-home-b' }],
        });
        if (!pureIroh.ok) throw new Error('Expected pure-Iroh QR transport');

        await expect(authQRStart(generateAuthKeyPair(), pureIroh.transport)).resolves.toBe(true);
        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: 'http://127.0.0.1:45992',
            credentials: null,
        }));
        await pureIroh.transport.close();
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a target without a usable endpoint URL', async () => {
        await expect(authQRStart(generateAuthKeyPair(), await enrollmentTarget('   '))).resolves.toBe(false);
        expect(createServerFetchAtEndpointMock).not.toHaveBeenCalled();
    });
});
