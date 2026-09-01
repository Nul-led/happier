import type { FeaturesResponse as ServerFeatures } from '@happier-dev/protocol';
import { IrohEndpointDescriptorV1Schema } from '@happier-dev/protocol';
import type { PeerRouteViabilityRecord as TransferRouteViabilityRecord } from '@happier-dev/peer-mediation';

import type { TransferRouteDecision, ResolveTransferRouteDecisionInput } from '../routing/resolveTransferRouteDecision';
import { resolveTransferRouteDecision } from '../routing/resolveTransferRouteDecision';
import {
    resolveMachineDaemonTransferDirectPeerDiagnostics,
    type MachineDaemonTransferDirectPeerDiagnostics,
} from './machineDaemonTransferState';

export type ResolveSessionFileTransferAvailabilityInput = Readonly<{
    sessionAvailable: boolean;
    machineTargetAvailable: boolean;
    serverFeatures: ServerFeatures | null;
    machineDaemonState?: unknown | null;
    irohPeerAvailable?: boolean;
    directPeerRoute?: TransferRouteViabilityRecord | null;
    machineRpcDirectRoute?: TransferRouteViabilityRecord | null;
    preferredRouteKinds?: ResolveTransferRouteDecisionInput['preferredRouteKinds'];
}>;

export type ResolveSessionFileTransferAvailabilityResult = Readonly<{
    available: boolean;
    decision: TransferRouteDecision | null;
    daemonDirectPeerDiagnostics: MachineDaemonTransferDirectPeerDiagnostics;
}>;

function resolveSessionDirectPeerRoute(
    daemonRoute: TransferRouteViabilityRecord,
    directPeerRoute?: TransferRouteViabilityRecord | null,
): TransferRouteViabilityRecord {
    if (daemonRoute.status !== 'viable') {
        return daemonRoute;
    }

    if (directPeerRoute?.status === 'viable' || directPeerRoute?.status === 'unavailable') {
        return directPeerRoute;
    }

    return daemonRoute;
}

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

    const daemonTransferRoute = daemonDirectPeerDiagnostics.route;
    const daemonIrohEndpoint = input.irohPeerAvailable === true && IrohEndpointDescriptorV1Schema.safeParse(
        (input.machineDaemonState as { peerMediation?: { iroh?: { endpoint?: unknown } } } | null | undefined)
            ?.peerMediation?.iroh?.endpoint,
    ).success;
    const directPeerRoute = daemonIrohEndpoint
        ? { status: 'viable' as const, checkedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }
        : resolveSessionDirectPeerRoute(daemonTransferRoute, input.directPeerRoute);

    const decision = resolveTransferRouteDecision({
        serverFeatures: input.serverFeatures,
        directPeerRoute: directPeerRoute ?? { status: 'unknown' },
        directPeerRouteKinds: daemonIrohEndpoint
            ? ['iroh_peer', ...daemonDirectPeerDiagnostics.activeRouteKinds.filter((kind) => kind !== 'iroh_peer')]
            : daemonDirectPeerDiagnostics.activeRouteKinds,
        machineRpcDirectRoute: input.machineRpcDirectRoute ?? { status: 'unknown' },
        preferredRouteKinds: input.preferredRouteKinds,
    });

    return {
        available: decision.kind === 'selected',
        decision,
        daemonDirectPeerDiagnostics,
    };
}
