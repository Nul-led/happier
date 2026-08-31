import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveHomeEnrollmentTransport } from './homeEnrollmentTransport';

const releaseSpy = vi.hoisted(() => vi.fn(async () => {}));
const acquireIrohHomeRuntimeOriginSpy = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>());
const createServerFetchAtEndpointSpy = vi.hoisted(() => vi.fn<(input: unknown) => ReturnType<typeof vi.fn>>(() => vi.fn()));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireIrohHomeRuntimeOriginSpy(input),
}));

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (input: unknown) => createServerFetchAtEndpointSpy(input),
}));

describe('resolveHomeEnrollmentTransport', () => {
    beforeEach(() => {
        acquireIrohHomeRuntimeOriginSpy.mockReset();
        acquireIrohHomeRuntimeOriginSpy.mockResolvedValue({
            leaseId: 'lease-home-b',
            localUrl: 'http://127.0.0.1:43123',
            runtimeOrigin: 'http://127.0.0.1:43123',
            homeServerIdentityId: 'srv_home_b',
            endpointId: 'iroh-home-b',
            carrier: 'iroh',
            observedPath: 'direct',
            status: 'ready',
            release: releaseSpy,
        });
        releaseSpy.mockClear();
        createServerFetchAtEndpointSpy.mockClear();
    });

    it('selects one public HTTPS application endpoint while retaining canonical identity', async () => {
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [
                { kind: 'https' as const, url: 'http://localhost:3010' },
                { kind: 'https' as const, url: 'https://home-b.test' },
            ],
        };
        const result = await resolveHomeEnrollmentTransport(descriptor);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.transport).toMatchObject({
            descriptor,
            canonicalServerUrl: 'http://localhost:3010',
            homeServerIdentityId: 'srv_home_b',
            endpointUrl: 'https://home-b.test',
            runtimeOrigin: 'https://home-b.test',
            carrier: 'https',
        });
        await result.transport.close();
        expect(releaseSpy).not.toHaveBeenCalled();
    });

    it('acquires a verified lease for pure Iroh while requests retain stable canonical identity', async () => {
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 7,
            endpoints: [{ kind: 'iroh' as const, endpointId: 'iroh-home-b' }],
        };
        const result = await resolveHomeEnrollmentTransport(descriptor);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledWith({
            homeServerIdentityId: 'srv_home_b',
            endpoint: descriptor.endpoints[0],
            descriptorRevision: 7,
            canonicalServerUrl: 'http://localhost:3010',
            verification: { kind: 'enrollment' },
        });
        result.transport.createRequest({ serverId: 'srv_home_b', credentials: null });
        expect(createServerFetchAtEndpointSpy).toHaveBeenCalledWith({
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: 'http://127.0.0.1:43123',
            serverId: 'srv_home_b',
            credentials: null,
        });
        await Promise.all([result.transport.close(), result.transport.close()]);
        expect(releaseSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to an independent HTTPS endpoint when Iroh acquisition fails on pure availability', async () => {
        acquireIrohHomeRuntimeOriginSpy.mockRejectedValueOnce(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [
                { kind: 'iroh', endpointId: 'iroh-home-b' },
                { kind: 'https', url: 'https://home-b.test' },
            ],
        });
        expect(result).toMatchObject({ ok: true, transport: {
            endpointUrl: 'https://home-b.test',
            runtimeOrigin: 'https://home-b.test',
            carrier: 'https',
        } });
    });

    it('fails closed on an Iroh identity mismatch even when an independent HTTPS endpoint exists', async () => {
        acquireIrohHomeRuntimeOriginSpy.mockRejectedValueOnce(
            Object.assign(new Error('identity mismatch'), { name: 'IrohError', code: 'identity_mismatch' }),
        );
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [
                { kind: 'iroh', endpointId: 'iroh-home-b' },
                { kind: 'https', url: 'https://home-b.test' },
            ],
        });
        expect(result).toEqual({
            ok: false,
            homeServerIdentityId: 'srv_home_b',
            reason: 'iroh_transport_failed_closed',
        });
        expect(releaseSpy).not.toHaveBeenCalled();
        expect(createServerFetchAtEndpointSpy).not.toHaveBeenCalled();
    });

    it('fails typed without requesting canonical loopback when pure Iroh acquisition fails', async () => {
        acquireIrohHomeRuntimeOriginSpy.mockRejectedValueOnce(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: 'iroh-home-b' }],
        });
        expect(result).toEqual({
            ok: false,
            homeServerIdentityId: 'srv_home_b',
            reason: 'iroh_transport_unavailable',
        });
        expect(createServerFetchAtEndpointSpy).not.toHaveBeenCalled();
    });

    it('uses an already resolved runtime origin without double-acquiring Iroh', async () => {
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://home-b.test',
            revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: 'iroh-home-b' }],
        }, { runtimeOrigin: 'http://localhost:43123' });
        expect(result.ok && result.transport.runtimeOrigin).toBe('http://localhost:43123');
        expect(acquireIrohHomeRuntimeOriginSpy).not.toHaveBeenCalled();
    });
});
