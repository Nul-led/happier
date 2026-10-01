import type { FeaturesResponse as ServerFeatures } from '@happier-dev/protocol';
import type { HomeApplicationCarrierEligibility } from '@happier-dev/cli-common/homeEnrollment';

import type { TransferRouteDecision } from '../routing/resolveTransferRouteDecision';
import { resolveTransferRouteDecision } from '../routing/resolveTransferRouteDecision';
import {
    isMachineFiniteTransferRpcDeclared,
    readCurrentMachineIrohEndpoint,
    resolveMachineCarrierPreselection,
    type MachineCarrierHostEligibility,
} from '../routing/resolveMachineCarrierPreselection';
import {
    isMachineDaemonFiniteTransferApplicationSupported,
    resolveMachineDaemonTransferDirectPeerDiagnostics,
    type MachineDaemonTransferDirectPeerDiagnostics,
} from './machineDaemonTransferState';

export type ResolveSessionFileTransferAvailabilityInput = Readonly<{
    applicationCarrierEligibility?: HomeApplicationCarrierEligibility;
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
        applicationCarrierEligibility: input.applicationCarrierEligibility,
        serverFeatures: input.serverFeatures,
        host: input.machineCarrierHost,
        targetEndpoint: readCurrentMachineIrohEndpoint({
            capabilities: input.machineOperationProtocolCapabilities,
            revision: input.machineOperationProtocolCapabilitiesRevision,
            active: input.machineActive,
            revokedAt: input.machineRevokedAt,
        }),
        finiteTransferApplicationSupported,
    }) : { kind: 'unavailable' as const };
    const selectedNow = { status: 'viable' as const, checkedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };

    const decision = machineCarrierPreselection.kind === 'unavailable'
        ? null
        : resolveTransferRouteDecision({
            serverFeatures: input.serverFeatures,
            directPeerRoute: selectedNow,
            directPeerRouteKinds: ['iroh_peer'],
            preferredRouteKinds: ['iroh_peer'],
        });

    return {
        available: decision?.kind === 'selected',
        decision,
        daemonDirectPeerDiagnostics,
    };
}
