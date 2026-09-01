import type { PeerTcpTunnelStreamConnection } from '@happier-dev/peer-transport';
import {
    IrohMachineHandshakeV1Schema,
    type IrohMachineCarrierFlowV1,
    type PeerFlowKindV1,
} from '@happier-dev/protocol';
import {
    verifyDirectRouteGrantV2,
    type DirectRouteGrantTrustRoot,
} from '../mediation/verifyDirectRouteGrantV1';

export const MACHINE_CARRIER_ALPN_V1 = 'happier/machine/1' as const;
export type MachineCarrierOperationKind = IrohMachineCarrierFlowV1;
export type MachineCarrierRole = 'initiator' | 'acceptor';
export const MACHINE_CARRIER_UNAVAILABLE_CODE = 'machine_carrier_unavailable' as const;
export const MACHINE_CARRIER_ROUTE_MISMATCH_CODE = 'machine_carrier_route_mismatch' as const;

/**
 * Admission is the narrow seam consumed by existing transfer/workspace owners.
 * It proves that a request has a usable authenticated machine/1 carrier; byte
 * movement and cancellation remain owned by the existing stream implementations.
 */
export type MachineCarrierAdmissionInput = Readonly<{
    operationId: string;
    sourceMachineId: string;
    targetMachineId: string;
    flow: MachineCarrierOperationKind;
    sourceWorkspaceRefId?: string;
    targetWorkspaceRefId?: string;
    signal?: AbortSignal;
}>;
export type MachineCarrierAdmission = (input: MachineCarrierAdmissionInput) => Promise<void>;

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
 * A real duplex machine/1 session. Admission without this stream is
 * deliberately not a usable carrier. `remoteEndpointId` is the authenticated
 * transport identity evidence the connection was admitted against; `alpn`,
 * `operationKind`, and `operationId` echo the validated handshake bindings.
 */
export type MachineCarrierConnection = Readonly<{
    alpn: typeof MACHINE_CARRIER_ALPN_V1;
    operationKind: MachineCarrierOperationKind;
    operationId: string;
    remoteEndpointId: string;
    observedPath: 'direct' | 'relay' | 'unknown';
    stream: PeerTcpTunnelStreamConnection;
    close: () => Promise<void>;
}>;

/** Narrow daemon-consumer seam used by transfer and workspace owners. */
export type MachineCarrierStreamOpen = (
    input: MachineCarrierAdmissionInput,
) => Promise<MachineCarrierConnection>;

/**
 * Transport boundary input. `remoteEndpointId` is the dial/peer hint derived
 * from the validated handshake — it is never treated as transport identity.
 */
export type MachineCarrierTransportOpenInput = Readonly<{
    alpn: typeof MACHINE_CARRIER_ALPN_V1;
    remoteEndpointId: string;
    flow: MachineCarrierOperationKind;
    operationId: string;
    /** Exact canonical handshake bytes parsed and verified by this adapter. */
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

type MachineCarrierInput = Readonly<{
    accountId: string;
    machineId: string;
    localEndpointId: string;
    role: MachineCarrierRole;
    trustRoots: readonly DirectRouteGrantTrustRoot[];
    nowMs: () => number;
    connect: (input: MachineCarrierTransportOpenInput) => Promise<MachineCarrierTransportConnection>;
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

async function closeRejectedConnection(connection: MachineCarrierTransportConnection): Promise<void> {
    try {
        await connection.close();
    } catch {
        // The transport already failed admission; surface the admission error.
    }
}

/**
 * Opens an authenticated machine/1 stream through a mandatory, fail-closed
 * handshake (canonical `IrohMachineHandshakeV1`). The handshake binds the
 * account, typed initiator, target Machine/current endpoint,
 * operation flow and id, and the signed `iroh_peer` grant with its verified
 * ephemeral nonce/proof (expiry is the signed grant's `exp`). The remote
 * endpoint identity is taken from the authenticated Iroh transport, compared
 * against the handshake/grant, and never trusted from caller text. Transfer
 * framing, encryption, receipts, and limits remain owned by the callers.
 */
export function createMachineCarrierAdapter(input: MachineCarrierInput) {
    return {
        async open(request: { handshake: unknown }): Promise<MachineCarrierConnection> {
            const { handshake, remoteEndpointId } = verifyMachineCarrierHandshakeV1({
                handshake: request?.handshake,
                accountId: input.accountId,
                machineId: input.machineId,
                localEndpointId: input.localEndpointId,
                role: input.role,
                trustRoots: input.trustRoots,
                nowMs: input.nowMs(),
            });
            const connection = await input.connect({
                alpn: MACHINE_CARRIER_ALPN_V1,
                remoteEndpointId,
                flow: handshake.flow,
                operationId: handshake.operationId,
                handshake,
            });
            // Transport evidence decides: the authenticated remote Iroh endpoint
            // identity must match the handshake/grant before any byte is handed out.
            if (typeof connection.remoteEndpointId !== 'string' || connection.remoteEndpointId.length === 0) {
                await closeRejectedConnection(connection);
                throw new MachineCarrierError(
                    'transport_identity_invalid',
                    'Machine transport did not return an authenticated remote endpoint identity.',
                );
            }
            if (connection.remoteEndpointId !== remoteEndpointId) {
                await closeRejectedConnection(connection);
                throw new MachineCarrierError(
                    'transport_identity_mismatch',
                    'Authenticated transport endpoint identity does not match the machine handshake.',
                );
            }
            return {
                alpn: MACHINE_CARRIER_ALPN_V1,
                operationKind: handshake.flow,
                operationId: handshake.operationId,
                remoteEndpointId: connection.remoteEndpointId,
                observedPath: connection.observedPath,
                stream: connection.stream,
                close: connection.close,
            };
        },
    };
}
