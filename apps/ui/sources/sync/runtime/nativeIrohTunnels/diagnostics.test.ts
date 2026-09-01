import { describe, expect, it } from 'vitest';

import {
    createInitialIrohHomeTransportDiagnostics,
    projectIrohHomeTransportDiagnosticsEvent,
} from './diagnostics';
import { createIrohHomeTunnelSupervisor } from './supervisor';

describe('native Iroh Home transport diagnostics projection', () => {
    it('retains exact applied configuration and sanitizes relay URLs', () => {
        const snapshot = createInitialIrohHomeTransportDiagnostics({
            homeServerIdentityId: 'home_1',
            policy: 'automatic',
            relayUrls: ['https://user:secret@relay.example.test/path?token=secret#fragment'],
            directAddresses: ['192.0.2.10:4433'],
            atMs: 10,
        });

        expect(snapshot).toMatchObject({
            homeServerIdentityId: 'home_1',
            state: 'connecting',
            effectiveConfiguration: {
                policy: 'automatic',
                relayUrls: ['https://relay.example.test/path'],
                directAddressCount: 1,
            },
            lastTransitionAtMs: 10,
        });
        expect(JSON.stringify(snapshot)).not.toContain('secret');
    });

    it('distinguishes current observations from last-known facts after degradation', () => {
        const initial = createInitialIrohHomeTransportDiagnostics({
            homeServerIdentityId: 'home_1',
            policy: 'disabled',
            atMs: 10,
        });
        const ready = projectIrohHomeTransportDiagnosticsEvent(initial, {
            type: 'ready',
            tunnelHandle: 'lease_1',
            status: 'ready',
            observedPath: 'direct',
            atMs: 20,
        });
        const degraded = projectIrohHomeTransportDiagnosticsEvent(ready, {
            type: 'degraded',
            tunnelHandle: 'lease_1',
            status: 'degraded',
            errorCode: 'transport_timeout',
            atMs: 30,
        });

        expect(degraded).toMatchObject({
            state: 'reconnecting',
            lastKnown: { carrier: 'iroh', observedPath: 'direct' },
            diagnosticError: { code: 'transport_timeout', atMs: 30 },
            lastTransitionAtMs: 30,
        });
        expect(degraded.current).toBeUndefined();
    });

    it('never infers direct or relay when native reports unknown', () => {
        const initial = createInitialIrohHomeTransportDiagnostics({
            homeServerIdentityId: 'home_1',
            policy: 'automatic',
            atMs: 10,
        });
        const ready = projectIrohHomeTransportDiagnosticsEvent(initial, {
            type: 'ready',
            tunnelHandle: 'lease_1',
            status: 'ready',
            observedPath: 'unknown',
            atMs: 20,
        });

        expect(ready.state).toBe('connected');
        expect(ready.current).toEqual({ carrier: 'iroh' });
        expect(ready.lastKnown).toEqual({ carrier: 'iroh' });
    });

    it('is retained by the existing supervisor after a verified native acquisition', async () => {
        const native = {
            ensureHomeTunnel: async () => ({
                leaseId: 'lease_1',
                homeServerIdentityId: 'home_1',
                homeEndpointId: 'endpoint_1',
                runtimeOrigin: 'http://127.0.0.1:47111',
                carrier: 'iroh' as const,
                observedPath: 'unknown' as const,
                startedAtMs: 10,
                release: async () => undefined,
            }),
            releaseHomeTunnel: async () => undefined,
        };
        const supervisor = createIrohHomeTunnelSupervisor({
            native,
            probe: async () => ({ ok: true }),
        });
        await supervisor.ensureTunnel({
            remoteHostId: 'home_1',
            purpose: 'home',
            homeServerIdentityId: 'home_1',
            endpointId: 'endpoint_1',
            canonicalServerUrl: 'https://home.example.test',
            policy: 'automatic',
            relayUrls: ['https://relay.example.test'],
            verification: { kind: 'enrollment' },
        });

        expect(supervisor.readDiagnostics()[0]).toMatchObject({
            state: 'connected',
            effectiveConfiguration: { policy: 'automatic', relayUrls: ['https://relay.example.test'] },
            current: { carrier: 'iroh' },
        });
    });

    it('reads an empty projection without constructing the singleton runtime', async () => {
        const { readIrohHomeTransportDiagnostics } = await import('./runtime');
        expect(readIrohHomeTransportDiagnostics()).toEqual([]);
    });
});
