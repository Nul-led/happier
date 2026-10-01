import { describe, expect, it } from 'vitest';

import { FeaturesResponseSchema } from '@happier-dev/protocol';

import { readCurrentMachineIrohEndpoint, resolveMachineCarrierPreselection } from './resolveMachineCarrierPreselection';

const features = FeaturesResponseSchema.parse({
    features: {
        machines: {
            enabled: true,
            transfer: {
                enabled: true,
                directPeer: { enabled: true },
                serverRouted: { enabled: false },
            },
            peerMediation: { enabled: true },
        },
    },
    capabilities: {},
});

describe('resolveMachineCarrierPreselection', () => {
    it('keeps mandatory machine transfers unavailable in Standard mode', () => {
        const common = {
            applicationCarrierEligibility: 'standard_only' as const,
            serverFeatures: features,
            targetEndpoint: { endpointId: 'a'.repeat(64), relayUrls: ['https://relay.example.test'] },
            host: { kind: 'browser' as const },
            finiteTransferApplicationSupported: true,
        };
        expect(resolveMachineCarrierPreselection(common)).toEqual({ kind: 'unavailable' });
    });
    it('prefers Iroh when both current carrier feature bits and the application route are usable', () => {
        expect(resolveMachineCarrierPreselection({
            serverFeatures: features,
            targetEndpoint: {
                endpointId: 'a'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            host: { kind: 'browser' },
            finiteTransferApplicationSupported: true,
        })).toMatchObject({ kind: 'iroh_peer', carrierKind: 'browser_stream' });
    });

    it('does not revive an undeclared daemon through RPC when Iroh is unavailable', () => {
        expect(resolveMachineCarrierPreselection({
            serverFeatures: features,
            targetEndpoint: null,
            host: { kind: 'native', lifecycleAvailable: false },
            finiteTransferApplicationSupported: false,
        })).toEqual({ kind: 'unavailable' });
    });

    it('keeps a current Runner unavailable when its Iroh endpoint or host is unavailable', () => {
        for (const targetEndpoint of [null, { endpointId: 'a'.repeat(64) }]) {
            expect(resolveMachineCarrierPreselection({
                serverFeatures: features,
                targetEndpoint,
                host: { kind: 'native', lifecycleAvailable: false },
                finiteTransferApplicationSupported: true,
            })).toEqual({ kind: 'unavailable' });
        }
    });

    it('takes current endpoint and hints only from the server-accepted projection', () => {
        const input = {
            capabilities: { irohMachineEndpoint: { protocolVersions: [1], endpointId: 'a'.repeat(64) } },
            revision: 2,
            active: true,
            revokedAt: null,
        };
        expect(readCurrentMachineIrohEndpoint(input)).toEqual({ endpointId: 'a'.repeat(64) });
        expect(readCurrentMachineIrohEndpoint({
            ...input,
            capabilities: {
                irohMachineEndpoint: {
                    protocolVersions: [1], endpointId: 'a'.repeat(64), relayUrls: ['https://current.example.test'],
                },
            },
        })).toEqual({ endpointId: 'a'.repeat(64), relayUrls: ['https://current.example.test'] });
        expect(readCurrentMachineIrohEndpoint({ ...input, revision: null })).toBeNull();
        expect(readCurrentMachineIrohEndpoint({ ...input, revokedAt: 1 })).toBeNull();
    });

    it('does not select Iroh from a predecessor-shaped payload that omits peer mediation', () => {
        const predecessorFeatures = FeaturesResponseSchema.parse({
            features: {
                machines: {
                    enabled: true,
                    transfer: {
                        enabled: true,
                        directPeer: { enabled: true },
                        serverRouted: { enabled: false },
                    },
                },
            },
            capabilities: {},
        });

        expect(resolveMachineCarrierPreselection({
            serverFeatures: predecessorFeatures,
            targetEndpoint: {
                endpointId: 'a'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            host: { kind: 'browser' },
            finiteTransferApplicationSupported: true,
        })).toEqual({ kind: 'unavailable' });
    });

    it('does not select Iroh when peer mediation is explicitly disabled', () => {
        const peerMediationDisabled = FeaturesResponseSchema.parse({
            features: {
                machines: {
                    enabled: true,
                    transfer: {
                        enabled: true,
                        directPeer: { enabled: true },
                        serverRouted: { enabled: false },
                    },
                    peerMediation: { enabled: false },
                },
            },
            capabilities: {},
        });

        expect(resolveMachineCarrierPreselection({
            serverFeatures: peerMediationDisabled,
            targetEndpoint: {
                endpointId: 'a'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            host: { kind: 'browser' },
            finiteTransferApplicationSupported: true,
        })).toEqual({ kind: 'unavailable' });
    });

    it('fails closed when neither finite-transfer route is proven usable', () => {
        expect(resolveMachineCarrierPreselection({
            serverFeatures: features,
            targetEndpoint: null,
            host: { kind: 'browser' },
            finiteTransferApplicationSupported: false,
        })).toEqual({ kind: 'unavailable' });
    });

    it('does not select an Iroh endpoint that has no current finite-transfer application', () => {
        expect(resolveMachineCarrierPreselection({
            serverFeatures: features,
            targetEndpoint: {
                endpointId: 'a'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            host: { kind: 'browser' },
            finiteTransferApplicationSupported: false,
        })).toEqual({ kind: 'unavailable' });
    });
});
