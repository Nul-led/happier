import { describe, expect, it } from 'vitest';

import { FeaturesResponseSchema } from '@happier-dev/protocol';

import { resolveMachineCarrierPreselection } from './resolveMachineCarrierPreselection';

const features = FeaturesResponseSchema.parse({
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

describe('resolveMachineCarrierPreselection', () => {
    it('prefers Iroh when Iroh and the predecessor finite-transfer RPC route are both usable', () => {
        expect(resolveMachineCarrierPreselection({
            serverFeatures: features,
            targetEndpoint: {
                endpointId: 'a'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            host: { kind: 'browser' },
            legacyTransferSupported: true,
            finiteTransferApplicationSupported: true,
            machineRpcDirectRoute: { status: 'viable', checkedAt: 1, expiresAt: 2 },
        })).toMatchObject({ kind: 'iroh_peer', carrierKind: 'browser_stream' });
    });

    it('selects the retained predecessor RPC transfer before prepare when Iroh is unavailable', () => {
        expect(resolveMachineCarrierPreselection({
            serverFeatures: features,
            targetEndpoint: null,
            host: { kind: 'native', lifecycleAvailable: false },
            legacyTransferSupported: true,
            finiteTransferApplicationSupported: false,
            machineRpcDirectRoute: { status: 'viable', checkedAt: 1, expiresAt: 2 },
        })).toEqual({ kind: 'legacy_machine_rpc' });
    });

    it('fails closed when neither finite-transfer route is proven usable', () => {
        expect(resolveMachineCarrierPreselection({
            serverFeatures: features,
            targetEndpoint: null,
            host: { kind: 'browser' },
            legacyTransferSupported: true,
            finiteTransferApplicationSupported: false,
            machineRpcDirectRoute: { status: 'unknown' },
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
            legacyTransferSupported: false,
            finiteTransferApplicationSupported: false,
            machineRpcDirectRoute: { status: 'unavailable', checkedAt: 1, expiresAt: 2 },
        })).toEqual({ kind: 'unavailable' });
    });
});
