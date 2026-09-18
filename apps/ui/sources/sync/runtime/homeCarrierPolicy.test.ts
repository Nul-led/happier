import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IrohError } from '@happier-dev/iroh-native';

const acquireBrowserSpy = vi.hoisted(() => vi.fn());
const acquireNativeSpy = vi.hoisted(() => vi.fn());
const browserEligibilitySpy = vi.hoisted(() => vi.fn());
const browserHostSpy = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/browserIroh/hostEligibility', () => ({
    resolveBrowserIrohHostDecision: () => browserHostSpy(),
}));
vi.mock('@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier', () => ({
    acquireBrowserIrohHomeCarrier: (input: unknown) => acquireBrowserSpy(input),
    resolveBrowserIrohHomeCarrierEligibility: (...args: unknown[]) => browserEligibilitySpy(...args),
}));
vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireNativeSpy(input),
}));

import {
    acquireEligibleHomeCarrier,
    drainRetainedHomeCarrierReleases,
} from './homeCarrierPolicy';
import { createIrohHomeTunnelSupervisor } from './nativeIrohTunnels/supervisor';

const endpoint = { endpointId: 'a'.repeat(64), relayUrls: ['https://relay.example.test/'] };
const baseInput = {
    mode: 'initial_selection' as const,
    applicationCarrierEligibility: 'automatic' as const,
    descriptor: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_a',
        canonicalServerUrl: 'https://canonical.example.test',
        revision: 7,
        endpoints: [
            { kind: 'iroh' as const, ...endpoint },
            { kind: 'https' as const, url: 'https://public.example.test' },
        ],
    },
    verification: { kind: 'authenticated' as const, token: 'home-token' },
};

describe('acquireEligibleHomeCarrier', () => {
    beforeEach(() => {
        acquireBrowserSpy.mockReset();
        acquireNativeSpy.mockReset();
        browserEligibilitySpy.mockReset();
        browserHostSpy.mockReset();
    });

    it('selects the declared HTTPS endpoint when it differs from the canonical audience and Iroh is absent', async () => {
        await expect(acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [{ kind: 'https', url: 'https://ingress.example.test' }],
            },
        })).resolves.toEqual({
            kind: 'https',
            runtimeOrigin: 'https://ingress.example.test',
        });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('returns only the acquired browser carrier when the browser carrier is eligible', async () => {
        const release = vi.fn(async () => {});
        const carrier = {
            leaseId: 'browser-lease',
            homeServerIdentityId: baseInput.descriptor.homeServerIdentityId,
            endpointId: endpoint.endpointId,
            release,
        };
        browserHostSpy.mockReturnValue({ eligible: true });
        browserEligibilitySpy.mockReturnValue({
            eligible: true,
            endpointId: endpoint.endpointId,
            relayUrls: endpoint.relayUrls,
        });
        acquireBrowserSpy.mockResolvedValue(carrier);

        const acquired = await acquireEligibleHomeCarrier(baseInput);
        expect(acquired).toEqual({
            kind: 'browser_iroh',
            carrier: { ...carrier, release: expect.any(Function) },
            release: expect.any(Function),
        });
        if (acquired.kind !== 'browser_iroh') return;
        expect(acquired.carrier.release).toBe(acquired.release);
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('returns only the acquired native runtime origin when the browser host is ineligible', async () => {
        const release = vi.fn(async () => {});
        const lease = {
            leaseId: 'native-lease',
            homeServerIdentityId: baseInput.descriptor.homeServerIdentityId,
            endpointId: endpoint.endpointId,
            runtimeOrigin: 'http://127.0.0.1:43123',
            status: 'ready',
            release,
        };
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        browserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'host_ineligible' });
        acquireNativeSpy.mockResolvedValue(lease);

        const acquired = await acquireEligibleHomeCarrier(baseInput);
        expect(acquired).toEqual({
            kind: 'native_iroh',
            lease: { ...lease, release: expect.any(Function) },
            release: expect.any(Function),
        });
        if (acquired.kind !== 'native_iroh') return;
        expect(acquired.lease.release).toBe(acquired.release);
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
    });

    it('fails closed and releases a browser carrier whose returned endpoint differs from the requested endpoint', async () => {
        const release = vi.fn(async () => {});
        browserHostSpy.mockReturnValue({ eligible: true });
        browserEligibilitySpy.mockReturnValue({ eligible: true, endpointId: endpoint.endpointId, relayUrls: endpoint.relayUrls });
        acquireBrowserSpy.mockResolvedValue({ leaseId: 'wrong-browser', endpointId: 'b'.repeat(64), release });

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toMatchObject({
            kind: 'fail_closed',
            fallbackAllowed: false,
        });
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('fails closed and releases a native carrier that is not verified ready', async () => {
        const release = vi.fn(async () => {});
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        acquireNativeSpy.mockResolvedValue({
            leaseId: 'not-ready-native',
            endpointId: endpoint.endpointId,
            runtimeOrigin: 'http://127.0.0.1:43123',
            status: 'degraded',
            release,
        });

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toMatchObject({
            kind: 'fail_closed',
            fallbackAllowed: false,
        });
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('owns failed release custody and retries it only on the next explicit drain', async () => {
        const release = vi.fn()
            .mockRejectedValueOnce(new Error('release failed'))
            .mockResolvedValueOnce(undefined);
        const carrier = {
            leaseId: 'browser-release-retry',
            homeServerIdentityId: baseInput.descriptor.homeServerIdentityId,
            endpointId: endpoint.endpointId,
            release,
        };
        browserHostSpy.mockReturnValue({ eligible: true });
        browserEligibilitySpy.mockReturnValue({ eligible: true, endpointId: endpoint.endpointId, relayUrls: endpoint.relayUrls });
        acquireBrowserSpy.mockResolvedValue(carrier);

        const acquired = await acquireEligibleHomeCarrier(baseInput);
        expect(acquired.kind).toBe('browser_iroh');
        if (acquired.kind !== 'browser_iroh') return;
        await expect(acquired.release()).rejects.toThrow('release failed');
        expect(release).toHaveBeenCalledTimes(1);

        await drainRetainedHomeCarrierReleases();
        expect(release).toHaveBeenCalledTimes(2);
        await expect(acquired.release()).resolves.toBeUndefined();
        expect(release).toHaveBeenCalledTimes(2);
    });

    it('returns independently trusted HTTPS only for an allowed Iroh fallback', async () => {
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        browserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'host_ineligible' });
        acquireNativeSpy.mockRejectedValue(new IrohError('unavailable', 'native unavailable'));

        await expect(acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [
                    { kind: 'iroh', ...endpoint },
                    { kind: 'https', url: 'HTTPS://Public.Example.test:443/api///?ignored=yes#fragment' },
                ],
            },
        })).resolves.toEqual({
            kind: 'https',
            runtimeOrigin: 'https://public.example.test/api',
        });
    });

    it('fails closed after the native supervisor starts a tunnel whose health probe fails', async () => {
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        browserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'host_ineligible' });
        const releaseHomeTunnel = vi.fn(async () => undefined);
        const supervisor = createIrohHomeTunnelSupervisor({
            native: {
                ensureHomeTunnel: vi.fn(async (request: { homeServerIdentityId: string; endpointId: string }) => ({
                    leaseId: 'native-started-before-health-failure',
                    homeServerIdentityId: request.homeServerIdentityId,
                    homeEndpointId: request.endpointId,
                    runtimeOrigin: 'http://127.0.0.1:43124',
                    carrier: 'iroh' as const,
                    observedPath: 'direct' as const,
                    startedAtMs: 1,
                })),
                releaseHomeTunnel,
            },
            probe: async () => ({ ok: false, reason: 'health-unavailable' }),
        });

        const result = await acquireEligibleHomeCarrier({
            ...baseInput,
            acquireNative: async (input) => {
                const lease = await supervisor.ensureTunnel({
                    remoteHostId: input.homeServerIdentityId,
                    purpose: 'home',
                    homeServerIdentityId: input.homeServerIdentityId,
                    endpointId: input.endpoint.endpointId,
                    canonicalServerUrl: input.canonicalServerUrl,
                    policy: input.policy ?? 'automatic',
                    ...(input.endpoint.relayUrls ? { relayUrls: input.endpoint.relayUrls } : {}),
                    ...(input.endpoint.directAddresses ? { directAddresses: input.endpoint.directAddresses } : {}),
                    verification: input.verification,
                });
                if (!lease.localUrl) throw new Error('test supervisor returned no local origin');
                return {
                    ...lease,
                    runtimeOrigin: lease.localUrl,
                    release: async () => await supervisor.releaseTunnel(lease.leaseId),
                };
            },
        });

        expect(result).toMatchObject({ kind: 'fail_closed', fallbackAllowed: false });
        expect(releaseHomeTunnel).toHaveBeenCalledTimes(1);
        expect(releaseHomeTunnel).toHaveBeenCalledWith('native-started-before-health-failure');
        expect(supervisor.listTunnels().leases).toEqual([]);
    });

    it('does not let unavailable cleanup mask a post-acquisition health failure', async () => {
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        browserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'host_ineligible' });
        const releaseHomeTunnel = vi.fn()
            .mockRejectedValueOnce(new IrohError('unavailable', 'desktop stop command unavailable'))
            .mockResolvedValueOnce(undefined);
        const supervisor = createIrohHomeTunnelSupervisor({
            native: {
                ensureHomeTunnel: vi.fn(async (request: { homeServerIdentityId: string; endpointId: string }) => ({
                    leaseId: 'native-started-before-cleanup-failure',
                    homeServerIdentityId: request.homeServerIdentityId,
                    homeEndpointId: request.endpointId,
                    runtimeOrigin: 'http://127.0.0.1:43125',
                    carrier: 'iroh' as const,
                    observedPath: 'direct' as const,
                    startedAtMs: 1,
                })),
                releaseHomeTunnel,
            },
            probe: async () => ({ ok: false, reason: 'health-unavailable' }),
        });

        const result = await acquireEligibleHomeCarrier({
            ...baseInput,
            acquireNative: async (input) => {
                const lease = await supervisor.ensureTunnel({
                    remoteHostId: input.homeServerIdentityId,
                    purpose: 'home',
                    homeServerIdentityId: input.homeServerIdentityId,
                    endpointId: input.endpoint.endpointId,
                    canonicalServerUrl: input.canonicalServerUrl,
                    policy: input.policy ?? 'automatic',
                    ...(input.endpoint.relayUrls ? { relayUrls: input.endpoint.relayUrls } : {}),
                    ...(input.endpoint.directAddresses ? { directAddresses: input.endpoint.directAddresses } : {}),
                    verification: input.verification,
                });
                if (!lease.localUrl) throw new Error('test supervisor returned no local origin');
                return {
                    ...lease,
                    runtimeOrigin: lease.localUrl,
                    release: async () => await supervisor.releaseTunnel(lease.leaseId),
                };
            },
        });

        expect(result).toMatchObject({ kind: 'fail_closed', fallbackAllowed: false });
        expect(releaseHomeTunnel).toHaveBeenCalledTimes(1);
        expect(supervisor.listTunnels().leases).toEqual([
            expect.objectContaining({ status: 'failed' }),
        ]);
        await supervisor.dispose();
        expect(releaseHomeTunnel).toHaveBeenCalledTimes(2);
    });

    it('treats missing browser carrier capability as unavailable without attempting the native carrier', async () => {
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'shared_worker_unsupported' });

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toEqual({
            kind: 'https',
            runtimeOrigin: 'https://public.example.test',
        });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('fails typed when the browser carrier is unsupported and no trusted HTTPS origin exists', async () => {
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'shared_worker_unsupported' });

        const result = await acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [{ kind: 'iroh', ...endpoint }],
            },
        });

        expect(result).toMatchObject({
            kind: 'fail_closed',
            fallbackAllowed: true,
            error: { name: 'IrohError', code: 'unavailable' },
        });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('keeps browser identity, credential, and endpoint ineligibility fail-closed', async () => {
        browserHostSpy.mockReturnValue({ eligible: true });
        browserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'credential_missing' });

        const result = await acquireEligibleHomeCarrier(baseInput);

        expect(result).toMatchObject({ kind: 'fail_closed', fallbackAllowed: false });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('returns fail-closed for identity failure even when HTTPS is independently trusted', async () => {
        const error = new IrohError('identity_mismatch', 'wrong endpoint');
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        browserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'host_ineligible' });
        acquireNativeSpy.mockRejectedValue(error);

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toEqual({
            kind: 'fail_closed',
            error,
            fallbackAllowed: false,
        });
    });

    it('fails closed as unavailable when an allowed fallback has no trusted HTTPS destination', async () => {
        const error = new IrohError('unavailable', 'native unavailable');
        browserHostSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        browserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'host_ineligible' });
        acquireNativeSpy.mockRejectedValue(error);

        await expect(acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [
                    { kind: 'iroh', ...endpoint },
                    { kind: 'https', url: 'http://not-independent.example.test' },
                ],
            },
        })).resolves.toEqual({
            kind: 'fail_closed',
            error,
            fallbackAllowed: true,
        });
    });
});
