import type { PeerTcpTunnelStreamConnection } from '@happier-dev/peer-transport';
import { MACHINE_ALPN } from '@happier-dev/iroh-native/node';
import {
    IrohMachineHandshakeV1Schema,
    type IrohMachineCarrierFlowV1,
    type PeerFlowKindV1,
} from '@happier-dev/protocol';
import {
    verifyDirectRouteGrantV2,
    type DirectRouteGrantTrustRoot,
} from '../mediation/verifyDirectRouteGrantV1';

export const MACHINE_CARRIER_ALPN_V1 = MACHINE_ALPN;
export type MachineCarrierOperationKind = IrohMachineCarrierFlowV1;
export type MachineCarrierRole = 'initiator' | 'acceptor';
export const MACHINE_CARRIER_UNAVAILABLE_CODE = 'machine_carrier_unavailable' as const;
export const MACHINE_CARRIER_ROUTE_MISMATCH_CODE = 'machine_carrier_route_mismatch' as const;

export class MachineCarrierError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'MachineCarrierError'; }
}

export function machineCarrierUnavailableError(): MachineCarrierError {
    return new MachineCarrierError(
        MACHINE_CARRIER_UNAVAILABLE_CODE,
        'Authenticated Iroh machine carrier is unavailable',
    );
}

export function machineCarrierRouteMismatchError(): MachineCarrierError {
    return new MachineCarrierError(
        MACHINE_CARRIER_ROUTE_MISMATCH_CODE,
        'Iroh machine carrier is required for this operation',
    );
}

/**
 * Transport boundary input. `remoteEndpointId` is the dial/peer hint derived
 * from the validated handshake — it is never treated as transport identity.
 */
export type MachineCarrierTransportOpenInput = Readonly<{
    alpn: typeof MACHINE_CARRIER_ALPN_V1;
    remoteEndpointId: string;
    flow: MachineCarrierOperationKind;
    /** Present only when the target consumes a signed operation identity. */
    operationId?: string;
    /** Exact canonical handshake bytes parsed and verified by `verifyMachineCarrierHandshakeV1`. */
    handshake: ReturnType<typeof IrohMachineHandshakeV1Schema.parse>;
}>;

/**
 * Transport boundary result. `remoteEndpointId` is the authenticated remote
 * Iroh endpoint identity observed by the Iroh transport (QUIC/TLS peer
 * identity) — evidence supplied by the transport, never caller text.
 */
export type MachineCarrierTransportConnection = Readonly<{
    remoteEndpointId: string;
    observedPath: 'direct' | 'relay' | 'unknown';
    stream: PeerTcpTunnelStreamConnection;
    close: () => Promise<void>;
}>;

export type MachineCarrierHandshakeVerificationInput = Readonly<{
    handshake: unknown;
    accountId: string;
    machineId: string;
    localEndpointId: string;
    role: MachineCarrierRole;
    trustRoots: readonly DirectRouteGrantTrustRoot[];
    nowMs: number;
    /** Authenticated Iroh peer identity from the transport/header, when already available. */
    authenticatedRemoteEndpointId?: string;
}>;

export type MachineCarrierVerifiedHandshake = Readonly<{
    handshake: ReturnType<typeof IrohMachineHandshakeV1Schema.parse>;
    remoteEndpointId: string;
}>;

/**
 * Pure admission verifier shared by dial-side setup and the accept-side HTTP
 * admission route. It never opens transport. Acceptors pass the authenticated
 * `X-Happier-Iroh-Remote-Endpoint-Id` value as
 * `authenticatedRemoteEndpointId`; a mismatch fails before a stream is exposed.
 */
export function verifyMachineCarrierHandshakeV1(
    input: MachineCarrierHandshakeVerificationInput,
): MachineCarrierVerifiedHandshake {
    const parsedHandshake = IrohMachineHandshakeV1Schema.safeParse(input.handshake);
    if (!parsedHandshake.success) {
        throw new MachineCarrierError(
            'handshake_invalid',
            'Machine carrier requires a well-formed happier/machine/1 handshake.',
        );
    }
    const handshake = parsedHandshake.data;
    const localIsMachineInitiator = handshake.initiator.kind === 'machine'
        && handshake.initiator.machineId === input.machineId;
    const localIsTarget = handshake.target.machineId === input.machineId;
    if (localIsMachineInitiator === localIsTarget) {
        throw new MachineCarrierError('handshake_local_machine_mismatch', 'Machine handshake does not bind the local machine.');
    }
    const localRole: MachineCarrierRole = localIsMachineInitiator ? 'initiator' : 'acceptor';
    if (localRole !== input.role) {
        throw new MachineCarrierError('handshake_role_mismatch', 'Machine handshake role does not match the local side of its absolute orientation.');
    }
    const localEndpointId = localIsMachineInitiator
        ? handshake.initiator.endpointId
        : handshake.target.endpointId;
    const remoteEndpointId = localIsMachineInitiator
        ? handshake.target.endpointId
        : handshake.initiator.endpointId;
    if (handshake.accountId !== input.accountId) {
        throw new MachineCarrierError('handshake_account_mismatch', 'Machine handshake account mismatch.');
    }
    if (localEndpointId !== input.localEndpointId) {
        throw new MachineCarrierError('handshake_local_endpoint_mismatch', 'Machine handshake does not bind the local endpoint identity.');
    }
    const verification = verifyDirectRouteGrantV2({
        grant: handshake.grant,
        proof: handshake.proof,
        trustRoots: input.trustRoots,
        nowMs: input.nowMs,
        expected: {
            accountId: input.accountId,
            machineId: handshake.target.machineId,
            flowKind: handshake.grant.payload.flowKind as PeerFlowKindV1,
            routeKind: 'iroh_peer',
            endpointFingerprint: handshake.target.endpointId,
            iroh: {
                initiator: handshake.initiator,
                target: handshake.target,
                operationKind: handshake.flow,
            },
        },
    });
    if (!verification.valid) {
        throw new MachineCarrierError(verification.reasonCode, `Machine route grant rejected: ${verification.reasonCode}.`);
    }
    if (
        input.authenticatedRemoteEndpointId !== undefined
        && input.authenticatedRemoteEndpointId !== remoteEndpointId
    ) {
        throw new MachineCarrierError(
            'transport_identity_mismatch',
            'Authenticated transport endpoint identity does not match the machine handshake.',
        );
    }
    return { handshake, remoteEndpointId };
}
