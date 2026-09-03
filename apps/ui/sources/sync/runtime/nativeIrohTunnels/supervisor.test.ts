import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIrohHomeTunnelSupervisor } from './supervisor';
import type { IrohHomeTunnelRequest } from './types';

function homeIdentity(index: number): string {
    return `srv_home_${String(index).padStart(3, '0')}`;
}

function makeRequest(homeServerIdentityId: string): IrohHomeTunnelRequest {
    return {
        remoteHostId: `profile-${homeServerIdentityId}`,
        purpose: 'home',
        homeServerIdentityId,
        endpointId: `endpoint-${homeServerIdentityId}`,
        canonicalServerUrl: `https://${homeServerIdentityId}.example.test`,
        policy: 'automatic',
        verification: { kind: 'authenticated', token: 'token-a' },
    };
}

function createNativeFake() {
    let counter = 0;
    return {
        ensureHomeTunnel: vi.fn(async (input: { homeServerIdentityId: string; endpointId: string }) => {
            counter += 1;
            return {
                leaseId: `native-lease-${counter}`,
                homeServerIdentityId: input.homeServerIdentityId,
                homeEndpointId: input.endpointId,
                runtimeOrigin: `http://127.0.0.1:${45000 + counter}`,
                carrier: 'iroh' as const,
                observedPath: 'direct' as const,
                startedAtMs: counter,
            };
        }),
        releaseHomeTunnel: vi.fn(async () => undefined),
    };
}

function createSupervisorUnderTest() {
    return createIrohHomeTunnelSupervisor({
        native: createNativeFake(),
        probe: async () => ({ ok: true }),
    });
}

describe('Iroh Home transport diagnostics retention', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('retains diagnostics for every Home holding an active lease, past the inactive history bound', async () => {
        const supervisor = createSupervisorUnderTest();
        const activeHomes = 70;
        for (let index = 0; index < activeHomes; index += 1) {
            await supervisor.ensureTunnel(makeRequest(homeIdentity(index)));
        }

        const diagnostics = supervisor.readDiagnostics();
        expect(diagnostics).toHaveLength(activeHomes);
        // The first (oldest transition) Home still holds a live lease and must
        // never be evicted to make room for a newer one.
        expect(diagnostics.map((entry) => entry.homeServerIdentityId)).toContain(homeIdentity(0));
        expect(diagnostics.every((entry) => entry.state === 'connected')).toBe(true);
    });

    it('bounds inactive Home history while keeping the most recent inactive entries', async () => {
        const supervisor = createSupervisorUnderTest();
        const releasedHomes = 80;
        for (let index = 0; index < releasedHomes; index += 1) {
            const lease = await supervisor.ensureTunnel(makeRequest(homeIdentity(index)));
            await supervisor.releaseTunnel(lease.leaseId);
        }

        const diagnostics = supervisor.readDiagnostics();
        expect(diagnostics.length).toBeLessThanOrEqual(64);
        expect(diagnostics.length).toBeGreaterThan(0);
        const retained = diagnostics.map((entry) => entry.homeServerIdentityId);
        expect(retained).toContain(homeIdentity(releasedHomes - 1));
        expect(retained).not.toContain(homeIdentity(0));
    });

    it('ages a Home fact through the existing release lifecycle and keeps its proven last-known path', async () => {
        const supervisor = createSupervisorUnderTest();
        const lease = await supervisor.ensureTunnel(makeRequest(homeIdentity(1)));
        expect(supervisor.readDiagnostics()[0]?.state).toBe('connected');

        await supervisor.releaseTunnel(lease.leaseId);

        const [released] = supervisor.readDiagnostics();
        expect(released?.homeServerIdentityId).toBe(homeIdentity(1));
        expect(released?.state).toBe('disconnected');
        expect(released?.current).toBeUndefined();
        expect(released?.lastKnown).toEqual({ carrier: 'iroh', observedPath: 'direct' });
    });

    it('ages every owned Home fact when the runtime is disposed', async () => {
        const supervisor = createSupervisorUnderTest();
        await supervisor.ensureTunnel(makeRequest(homeIdentity(1)));
        await supervisor.ensureTunnel(makeRequest(homeIdentity(2)));

        await supervisor.dispose();

        const diagnostics = supervisor.readDiagnostics();
        expect(diagnostics.map((entry) => entry.homeServerIdentityId)).toEqual([homeIdentity(1), homeIdentity(2)]);
        expect(diagnostics.every((entry) => entry.state === 'disconnected')).toBe(true);
        expect(diagnostics.every((entry) => entry.current === undefined)).toBe(true);
    });

    it('keeps native custody owned when a rejected start could not release its lease, and retries it at disposal', async () => {
        const releaseHomeTunnel = vi.fn(async () => { throw new Error('native release failed'); });
        const supervisor = createIrohHomeTunnelSupervisor({
            native: {
                // A misrouted native result: the lease is bound to another Home,
                // so the adapter fails closed and must clean the lease up.
                ensureHomeTunnel: vi.fn(async (input: { endpointId: string }) => ({
                    leaseId: 'native-lease-mismatched',
                    homeServerIdentityId: 'srv_home_other',
                    homeEndpointId: input.endpointId,
                    runtimeOrigin: 'http://127.0.0.1:45001',
                    carrier: 'iroh' as const,
                    observedPath: 'direct' as const,
                    startedAtMs: 1,
                })),
                releaseHomeTunnel,
            },
            probe: async () => ({ ok: true }),
        });

        await expect(supervisor.ensureTunnel(makeRequest(homeIdentity(1))))
            .rejects.toMatchObject({ code: 'identity_mismatch' });
        // Immediate cleanup plus one retry at the failed start's terminal
        // boundary; the still-unreleased lease stays owned rather than orphaned.
        expect(releaseHomeTunnel.mock.calls).toHaveLength(2);

        await supervisor.dispose();

        expect(releaseHomeTunnel.mock.calls).toHaveLength(3);
        expect(releaseHomeTunnel).toHaveBeenCalledWith('native-lease-mismatched');
    });

    it('keeps each read Home-scoped when a non-focused Home is released', async () => {
        const supervisor = createSupervisorUnderTest();
        const focused = await supervisor.ensureTunnel(makeRequest(homeIdentity(1)));
        const secondary = await supervisor.ensureTunnel(makeRequest(homeIdentity(2)));

        await supervisor.releaseTunnel(secondary.leaseId);

        const diagnostics = supervisor.readDiagnostics();
        expect(diagnostics.map((entry) => entry.homeServerIdentityId)).toEqual([homeIdentity(1), homeIdentity(2)]);
        expect(diagnostics[0]?.state).toBe('connected');
        expect(diagnostics[0]?.remoteEndpointId).toBe(`endpoint-${homeIdentity(1)}`);
        expect(diagnostics[1]?.state).toBe('disconnected');
        expect(diagnostics[1]?.remoteEndpointId).toBe(`endpoint-${homeIdentity(2)}`);

        await supervisor.releaseTunnel(focused.leaseId);
        expect(supervisor.readDiagnostics().every((entry) => entry.state === 'disconnected')).toBe(true);
    });
});
