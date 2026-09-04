import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
    DIRECT_ROUTE_GRANT_AUDIENCE_V1,
    createDirectRouteGrantSigningInputV2,
    createEphemeralPeerRouteProofHandleV2,
    type DirectRouteGrantPayloadV2,
    type IrohMachineHandshakeV1,
    type SignedDirectRouteGrantV2,
} from '@happier-dev/protocol';

import * as machineCarrierModule from './machineCarrier';
import {
    verifyMachineCarrierHandshakeV1,
    type MachineCarrierOperationKind,
} from './machineCarrier';

function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

const signingKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
const trustRoots = [{
    keyId: 'key-1',
    publicKey: toBase64Url(signingKeyPair.publicKey),
}];

// Strict endpoint-id grammar (64 lowercase hex = 32-byte Iroh endpoint identity).
const SOURCE_ENDPOINT_ID = 'a'.repeat(64);
const TARGET_ENDPOINT_ID = 'b'.repeat(64);

const ACCOUNT_ID = 'account-1';
const SOURCE_MACHINE_ID = 'machine-1';
const TARGET_MACHINE_ID = 'machine-2';
const WORKSPACE_OPERATION_ID = 'operation-1';

interface HandshakeOverrides {
    accountId?: string;
    initiatorKind?: 'machine' | 'account_client';
    sourceMachineId?: string;
    targetMachineId?: string;
    sourceEndpointId?: string;
    targetEndpointId?: string;
    flow?: MachineCarrierOperationKind;
    operationId?: string;
    grantOverrides?: Partial<DirectRouteGrantPayloadV2>;
    breakProof?: boolean;
}

function createGrantPayload(overrides: Partial<DirectRouteGrantPayloadV2> = {}): DirectRouteGrantPayloadV2 {
    return {
        v: 2,
        grantId: 'grant-1',
        accountId: ACCOUNT_ID,
        machineId: TARGET_MACHINE_ID,
        flowKind: 'bounded_transfer',
        routeKind: 'iroh_peer',
        scope: { kind: 'bounded_transfer', mode: 'carrier' },
        iat: 1_000,
        exp: 10_000,
        aud: DIRECT_ROUTE_GRANT_AUDIENCE_V1,
        endpointFingerprint: TARGET_ENDPOINT_ID,
        iroh: {
            initiator: {
                kind: 'machine',
                machineId: SOURCE_MACHINE_ID,
                endpointId: SOURCE_ENDPOINT_ID,
            },
            target: {
                machineId: TARGET_MACHINE_ID,
                endpointId: TARGET_ENDPOINT_ID,
            },
            operationKind: 'finite_transfer',
        },
        proofKind: 'ephemeral_ed25519',
        ephemeralPublicKeyBase64Url: '',
        ...overrides,
    };
}

function signGrant(payload: DirectRouteGrantPayloadV2): SignedDirectRouteGrantV2 {
    return {
        payload,
        signature: {
            keyId: 'key-1',
            alg: 'Ed25519',
            valueBase64Url: toBase64Url(tweetnacl.sign.detached(
                Buffer.from(createDirectRouteGrantSigningInputV2(payload), 'utf8'),
                signingKeyPair.secretKey,
            )),
        },
    };
}

function createHandshake(overrides: HandshakeOverrides = {}): IrohMachineHandshakeV1 {
    const grantOverrides = overrides.grantOverrides ?? {};
    const sourceMachineId = overrides.sourceMachineId ?? SOURCE_MACHINE_ID;
    const targetMachineId = overrides.targetMachineId ?? TARGET_MACHINE_ID;
    const sourceEndpointId = overrides.sourceEndpointId ?? SOURCE_ENDPOINT_ID;
    const targetEndpointId = overrides.targetEndpointId ?? TARGET_ENDPOINT_ID;
    const flow = overrides.flow ?? 'finite_transfer';
    const initiator: IrohMachineHandshakeV1['initiator'] = overrides.initiatorKind === 'account_client'
        ? { kind: 'account_client', endpointId: sourceEndpointId }
        : { kind: 'machine', machineId: sourceMachineId, endpointId: sourceEndpointId };
    const payload = createGrantPayload({
        machineId: targetMachineId,
        endpointFingerprint: targetEndpointId,
        iroh: {
            initiator,
            target: { machineId: targetMachineId, endpointId: targetEndpointId },
            operationKind: flow,
        },
        ...grantOverrides,
    });
    const handle = createEphemeralPeerRouteProofHandleV2({ randomBytes: (length) => tweetnacl.randomBytes(length) });
    const grant = signGrant({ ...payload, ephemeralPublicKeyBase64Url: handle.publicKeyBase64Url });
    const proof = handle.sign(grant);
    const common = {
        v: 1,
        accountId: overrides.accountId ?? ACCOUNT_ID,
        initiator,
        target: { machineId: targetMachineId, endpointId: targetEndpointId },
        grant,
        proof: overrides.breakProof ? { ...proof, nonceBase64Url: toBase64Url(new Uint8Array(16).fill(7)) } : proof,
    } as const;
    return flow === 'workspace_sync'
        ? { ...common, flow, operationId: overrides.operationId ?? WORKSPACE_OPERATION_ID }
        : { ...common, flow };
}

describe('machine/1 carrier lifecycle', () => {
    it('exposes only the retained machine-carrier owner surface', () => {
        // The admission-era facade (`createMachineCarrierAdapter` and its
        // admission/connection/stream types) has no production or public
        // consumer. The live dial/accept machine paths own their seams through
        // `verifyMachineCarrierHandshakeV1`, the transport types, and the
        // native tunnel runtime; runtime exports are the observable boundary.
        expect(Object.keys(machineCarrierModule).sort()).toEqual([
            'MACHINE_CARRIER_ALPN_V1',
            'MACHINE_CARRIER_ROUTE_MISMATCH_CODE',
            'MACHINE_CARRIER_UNAVAILABLE_CODE',
            'MachineCarrierError',
            'machineCarrierRouteMismatchError',
            'machineCarrierUnavailableError',
            'verifyMachineCarrierHandshakeV1',
        ].sort());
        expect(machineCarrierModule.MACHINE_CARRIER_ALPN_V1).toBe('happier/machine/1');
    });

    it('verifies accept-side admission without opening transport and binds the authenticated source endpoint', () => {
        const handshake = createHandshake();
        expect(verifyMachineCarrierHandshakeV1({
            handshake,
            accountId: ACCOUNT_ID,
            machineId: TARGET_MACHINE_ID,
            localEndpointId: TARGET_ENDPOINT_ID,
            role: 'acceptor',
            trustRoots,
            nowMs: 2_000,
            authenticatedRemoteEndpointId: SOURCE_ENDPOINT_ID,
        })).toMatchObject({ remoteEndpointId: SOURCE_ENDPOINT_ID });
        expect(() => verifyMachineCarrierHandshakeV1({
            handshake,
            accountId: ACCOUNT_ID,
            machineId: TARGET_MACHINE_ID,
            localEndpointId: TARGET_ENDPOINT_ID,
            role: 'acceptor',
            trustRoots,
            nowMs: 2_000,
            authenticatedRemoteEndpointId: 'c'.repeat(64),
        })).toThrow('Authenticated transport endpoint identity does not match the machine handshake.');
    });

    it('rejects an expired grant through the shared grant verifier before any transport is opened', () => {
        const expired = createHandshake({ grantOverrides: { exp: 2_000 } });
        expect(() => verifyMachineCarrierHandshakeV1({
            handshake: expired,
            accountId: ACCOUNT_ID,
            machineId: TARGET_MACHINE_ID,
            localEndpointId: TARGET_ENDPOINT_ID,
            role: 'acceptor',
            trustRoots,
            nowMs: 2_000,
            authenticatedRemoteEndpointId: SOURCE_ENDPOINT_ID,
        })).toThrow('Machine route grant rejected: grant_expired.');
    });
});
