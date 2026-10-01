import {
    PEER_MEDIATION_RECEIPTS,
    type PeerFlowKindV1,
} from '@happier-dev/protocol';

export type PeerLoopbackRouteAvailabilityResult =
    | Readonly<{
        kind: 'selected';
        receipt: typeof PEER_MEDIATION_RECEIPTS.routeSelected;
        routeKind: 'loopback_direct';
        flowKind: PeerFlowKindV1;
        endpointFingerprint: string;
    }>
    | Readonly<{
        kind: 'fallback';
        receipt: typeof PEER_MEDIATION_RECEIPTS.routeFallback;
        reasonCode: string;
    }>;
