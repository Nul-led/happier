import type { FeaturesResponse as ServerFeatures } from '@happier-dev/protocol';
import type { PeerRouteViabilityRecord as TransferRouteViabilityRecord } from '@happier-dev/peer-mediation';

import type { TransferRouteDecision } from '../routing/resolveTransferRouteDecision';
import { resolveTransferRouteDecision } from '../routing/resolveTransferRouteDecision';
import {
    isMachineFiniteTransferRpcDeclared,
    resolveMachineCarrierPreselection,
    type MachineCarrierHostEligibility,
} from '../routing/resolveMachineCarrierPreselection';
import {
    isMachineDaemonLegacyTransferRpcEligible,
    isMachineDaemonFiniteTransferApplicationSupported,
    resolveMachineDaemonTransferDirectPeerDiagnostics,
    type MachineDaemonTransferDirectPeerDiagnostics,
} from './machineDaemonTransferState';

export type ResolveSessionFileTransferAvailabilityInput = Readonly<{
    sessionAvailable: boolean;
    machineTargetAvailable: boolean;
    serverFeatures: ServerFeatures | null;
    machineDaemonState?: unknown | null;
    /** Strict Machine declaration; the only reachability source a Runner has. */
    machineOperationProtocolCapabilities?: unknown | null;
    machineOperationProtocolCapabilitiesRevision?: unknown;
    machineKind?: 'persistent' | 'ephemeral_session_runner' | null;
    machineActive?: boolean | null;
    machineRevokedAt?: unknown;
    machineCarrierHost?: MachineCarrierHostEligibility;
    machineRpcDirectRoute?: TransferRouteViabilityRecord | null;
}>;

export type ResolveSessionFileTransferAvailabilityResult = Readonly<{
    available: boolean;
    decision: TransferRouteDecision | null;
    daemonDirectPeerDiagnostics: MachineDaemonTransferDirectPeerDiagnostics;
}>;

export function resolveSessionFileTransferAvailability(
    input: ResolveSessionFileTransferAvailabilityInput,
): ResolveSessionFileTransferAvailabilityResult {
    const daemonDirectPeerDiagnostics = resolveMachineDaemonTransferDirectPeerDiagnostics({
        daemonState: input.machineDaemonState,
    });

    if (!input.sessionAvailable || !input.machineTargetAvailable || !input.serverFeatures) {
        return {
            available: false,
            decision: null,
            daemonDirectPeerDiagnostics,
        };
    }

    const runnerFiniteTransferRpcDeclared = input.machineKind === 'ephemeral_session_runner' && isMachineFiniteTransferRpcDeclared({
        capabilities: input.machineOperationProtocolCapabilities,
        revision: input.machineOperationProtocolCapabilitiesRevision,
        active: input.machineActive,
        revokedAt: input.machineRevokedAt,
    });
    const finiteTransferApplicationSupported = input.machineKind === 'ephemeral_session_runner'
        ? runnerFiniteTransferRpcDeclared
        : isMachineDaemonFiniteTransferApplicationSupported(input.machineDaemonState);

    const machineCarrierPreselection = input.machineCarrierHost ? resolveMachineCarrierPreselection({
        serverFeatures: input.serverFeatures,
        host: input.machineCarrierHost,
        targetEndpoint:
            (input.machineDaemonState as { peerMediation?: { iroh?: { endpoint?: unknown } } } | null | undefined)
                ?.peerMediation?.iroh?.endpoint,
        legacyTransferSupported: isMachineDaemonLegacyTransferRpcEligible(input.machineDaemonState),
        finiteTransferApplicationSupported,
        runnerFiniteTransferRpcDeclared,
        machineRpcDirectRoute: input.machineRpcDirectRoute ?? { status: 'unknown' },
    }) : { kind: 'unavailable' as const };
    const selectedNow = { status: 'viable' as const, checkedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };

    const decision = machineCarrierPreselection.kind === 'unavailable'
        ? null
        : resolveTransferRouteDecision({
            serverFeatures: input.serverFeatures,
            directPeerRoute: machineCarrierPreselection.kind === 'iroh_peer'
                ? selectedNow
                : { status: 'unavailable', checkedAt: 0, expiresAt: 0, failureReason: 'finite_transfer_route_unavailable' },
            directPeerRouteKinds: machineCarrierPreselection.kind === 'iroh_peer' ? ['iroh_peer'] : [],
            machineRpcDirectRoute: machineCarrierPreselection.kind === 'legacy_machine_rpc'
                ? selectedNow
                : { status: 'unavailable', checkedAt: 0, expiresAt: 0, failureReason: 'finite_transfer_route_unavailable' },
            preferredRouteKinds: machineCarrierPreselection.kind === 'iroh_peer' ? ['iroh_peer'] : ['machine_rpc_direct'],
        });

    return {
        available: decision?.kind === 'selected',
        decision,
        daemonDirectPeerDiagnostics,
    };
}
