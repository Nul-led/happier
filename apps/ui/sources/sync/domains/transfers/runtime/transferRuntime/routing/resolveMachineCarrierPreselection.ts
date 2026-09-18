import {
    IrohEndpointDescriptorV1Schema,
    readServerEnabledBit,
    supportsMachineOperationProtocolCapabilityV1,
    type FeaturesResponse as ServerFeatures,
    type IrohEndpointDescriptorV1,
} from '@happier-dev/protocol';
import type { PeerRouteViabilityRecord } from '@happier-dev/peer-mediation';

export type MachineCarrierHostEligibility =
    | Readonly<{ kind: 'browser' }>
    | Readonly<{ kind: 'native'; lifecycleAvailable: boolean }>;

export type MachineCarrierPreselection =
    | Readonly<{
        kind: 'iroh_peer';
        carrierKind: 'browser_stream' | 'native_http';
        targetEndpoint: IrohEndpointDescriptorV1;
    }>
    | Readonly<{ kind: 'legacy_machine_rpc' }>
    | Readonly<{ kind: 'unavailable' }>;

/**
 * The one reader for a Machine's declared finite-transfer RPC ingress. The
 * declaration is only trusted from a currently active, non-revoked Machine at a
 * server-assigned projection revision; absence is never support.
 */
export function isMachineFiniteTransferRpcDeclared(input: Readonly<{
    capabilities: unknown;
    revision: unknown;
    active?: boolean | null;
    revokedAt?: unknown;
}>): boolean {
    if (input.active === false || (input.revokedAt !== null && input.revokedAt !== undefined)) return false;
    if (!Number.isInteger(input.revision) || (input.revision as number) < 1) return false;
    return supportsMachineOperationProtocolCapabilityV1(input.capabilities, 'finiteTransferRpc');
}

/** The one pure, pre-prepare finite-transfer route decision shared by controls and execution. */
export function resolveMachineCarrierPreselection(input: Readonly<{
    serverFeatures: ServerFeatures | null;
    targetEndpoint: unknown;
    host: MachineCarrierHostEligibility;
    legacyTransferSupported: boolean;
    /** Exact current finite-transfer application support for this Machine role. */
    finiteTransferApplicationSupported: boolean;
    /** Current Runner declaration; authoritative, so it needs no daemon probe. */
    runnerFiniteTransferRpcDeclared?: boolean;
    machineRpcDirectRoute: PeerRouteViabilityRecord;
}>): MachineCarrierPreselection {
    if (!input.serverFeatures || readServerEnabledBit(input.serverFeatures, 'machines.transfer') !== true) {
        return { kind: 'unavailable' };
    }

    const endpoint = IrohEndpointDescriptorV1Schema.safeParse(input.targetEndpoint);
    if (
        input.finiteTransferApplicationSupported
        && endpoint.success
        && readServerEnabledBit(input.serverFeatures, 'machines.transfer.directPeer') === true
    ) {
        if (input.host.kind === 'browser' && (endpoint.data.relayUrls?.length ?? 0) > 0) {
            return { kind: 'iroh_peer', carrierKind: 'browser_stream', targetEndpoint: endpoint.data };
        }
        if (input.host.kind === 'native' && input.host.lifecycleAvailable) {
            return { kind: 'iroh_peer', carrierKind: 'native_http', targetEndpoint: endpoint.data };
        }
    }

    // A Runner has no daemon transfer state. Its strict operation declaration is
    // published only after its handlers exist, so it establishes reachability.
    if (input.runnerFiniteTransferRpcDeclared === true) {
        return { kind: 'legacy_machine_rpc' };
    }

    if (input.legacyTransferSupported && input.machineRpcDirectRoute.status === 'viable') {
        return { kind: 'legacy_machine_rpc' };
    }

    return { kind: 'unavailable' };
}
