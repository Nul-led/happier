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

import {
    MACHINE_CARRIER_ALPN_V1,
    createMachineCarrierAdapter,
    verifyMachineCarrierHandshakeV1,
    type MachineCarrierOperationKind,
    type MachineCarrierRole,
    type MachineCarrierTransportConnection,
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
const OPERATION_ID = 'operation-1';

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
        scope: {
            kind: 'bounded_transfer',
            mode: 'single',
            transferId: OPERATION_ID,
            maxBytes: 1024,
        },
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
            operationKind: 'file_transfer',
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
    const flow = overrides.flow ?? 'file_transfer';
    const payload = createGrantPayload({
        machineId: targetMachineId,
        endpointFingerprint: targetEndpointId,
        iroh: {
            initiator: overrides.initiatorKind === 'account_client'
                ? { kind: 'account_client', endpointId: sourceEndpointId }
                : { kind: 'machine', machineId: sourceMachineId, endpointId: sourceEndpointId },
            target: { machineId: targetMachineId, endpointId: targetEndpointId },
            operationKind: flow,
        },
        ...grantOverrides,
    });
    const handle = createEphemeralPeerRouteProofHandleV2({ randomBytes: (length) => tweetnacl.randomBytes(length) });
    const grant = signGrant({ ...payload, ephemeralPublicKeyBase64Url: handle.publicKeyBase64Url });
    const proof = handle.sign(grant);
    return {
        v: 1,
        accountId: overrides.accountId ?? ACCOUNT_ID,
        initiator: overrides.initiatorKind === 'account_client'
            ? { kind: 'account_client', endpointId: sourceEndpointId }
            : { kind: 'machine', machineId: sourceMachineId, endpointId: sourceEndpointId },
        target: { machineId: targetMachineId, endpointId: targetEndpointId },
        flow,
        operationId: overrides.operationId ?? OPERATION_ID,
        grant,
        proof: overrides.breakProof ? { ...proof, nonceBase64Url: toBase64Url(new Uint8Array(16).fill(7)) } : proof,
    };
}

interface AdapterOverrides {
    accountId?: string;
    machineId?: string;
    localEndpointId?: string;
    role?: MachineCarrierRole;
    nowMs?: number;
    remoteEndpointId?: string;
}

function createRecordingAdapter(overrides: AdapterOverrides = {}) {
    const connectInputs: unknown[] = [];
    const closedStreams: string[] = [];
    const adapter = createMachineCarrierAdapter({
        accountId: overrides.accountId ?? ACCOUNT_ID,
        machineId: overrides.machineId ?? TARGET_MACHINE_ID,
        localEndpointId: overrides.localEndpointId ?? TARGET_ENDPOINT_ID,
        role: overrides.role ?? 'acceptor',
        trustRoots,
        nowMs: () => overrides.nowMs ?? 2_000,
        connect: async (connectInput) => {
            connectInputs.push(connectInput);
            const connection: MachineCarrierTransportConnection = {
                remoteEndpointId: overrides.remoteEndpointId ?? SOURCE_ENDPOINT_ID,
                observedPath: 'direct',
                stream: {
                    write: async () => undefined,
                    endWrite: async () => undefined,
                    onData: () => () => undefined,
                    close: async () => undefined,
                },
                close: async () => {
                    closedStreams.push('stream');
                },
            };
            return connection;
        },
    });
    return { adapter, connectInputs, closedStreams };
}

describe('machine/1 carrier lifecycle', () => {
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

    it('admits a validated acceptor handshake and returns the authenticated machine/1 stream', async () => {
        const { adapter, connectInputs } = createRecordingAdapter();
        const handshake = createHandshake();
        const session = await adapter.open({ handshake });

        expect(session).toMatchObject({
            alpn: MACHINE_CARRIER_ALPN_V1,
            operationKind: 'file_transfer',
            operationId: OPERATION_ID,
            observedPath: 'direct',
            remoteEndpointId: SOURCE_ENDPOINT_ID,
        });
        expect(session.stream).toBeDefined();
        // The dial hint is derived from the validated handshake, not caller text.
        expect(connectInputs).toEqual([{
            alpn: MACHINE_CARRIER_ALPN_V1,
            remoteEndpointId: SOURCE_ENDPOINT_ID,
            flow: 'file_transfer',
            operationId: OPERATION_ID,
            handshake,
        }]);
        await session.close();
    });

    it('admits an authenticated Account client endpoint without requiring a source Machine', async () => {
        const { adapter } = createRecordingAdapter();
        const session = await adapter.open({ handshake: createHandshake({ initiatorKind: 'account_client' }) });

        expect(session.remoteEndpointId).toBe(SOURCE_ENDPOINT_ID);
        expect(session.operationKind).toBe('file_transfer');
        await session.close();
    });

    it('admits a validated initiator handshake against the mirrored transport identity', async () => {
        const { adapter } = createRecordingAdapter({
            machineId: SOURCE_MACHINE_ID,
            localEndpointId: SOURCE_ENDPOINT_ID,
            role: 'initiator',
            remoteEndpointId: TARGET_ENDPOINT_ID,
        });
        const session = await adapter.open({ handshake: createHandshake() });

        expect(session.remoteEndpointId).toBe(TARGET_ENDPOINT_ID);
        expect(session.stream).toBeDefined();
        await session.close();
    });

    it('admits workspace_sync through both bounded-transfer and machine-rpc grants', async () => {
        for (const flowKind of ['bounded_transfer', 'machine_rpc'] as const) {
            const { adapter } = createRecordingAdapter();
            const handshake = createHandshake({
                flow: 'workspace_sync',
                grantOverrides: flowKind === 'machine_rpc'
                    ? {
                        flowKind,
                        scope: {
                            kind: 'machine_rpc',
                            rpcScopeId: OPERATION_ID,
                            allowedMethods: ['workspace.sync'],
                            maxCalls: 8,
                            maxIdleMs: 60_000,
                        },
                    }
                    : { flowKind },
            });
            const session = await adapter.open({ handshake });
            expect(session.operationKind).toBe('workspace_sync');
            await session.close();
        }
    });

    it('fails closed when the handshake is missing or malformed, before connecting', async () => {
        for (const handshake of [undefined, null, {}, { ...createHandshake(), extra: true }, { ...createHandshake(), v: 2 }, {
            ...createHandshake(),
            initiator: { kind: 'machine', machineId: SOURCE_MACHINE_ID, endpointId: 'endpoint-1' },
        }, { ...createHandshake(), grant: { ...createHandshake().grant, payload: { ...createHandshake().grant.payload, v: 1 } } }]) {
            const { adapter, connectInputs } = createRecordingAdapter();
            await expect(adapter.open({ handshake })).rejects.toMatchObject({
                code: 'handshake_invalid',
            });
            expect(connectInputs).toEqual([]);
        }
    });

    it('fails closed when the transport returns no usable authenticated endpoint identity', async () => {
        const { adapter, closedStreams } = createRecordingAdapter({ remoteEndpointId: '' });
        await expect(adapter.open({ handshake: createHandshake() })).rejects.toMatchObject({
            code: 'transport_identity_invalid',
        });
        // The unusable stream is closed; it is never handed back to the caller.
        expect(closedStreams).toEqual(['stream']);
    });

    it('fails closed and closes the stream when the authenticated transport identity mismatches the handshake', async () => {
        const wrongEndpointId = 'c'.repeat(64);
        const { adapter, closedStreams } = createRecordingAdapter({ remoteEndpointId: wrongEndpointId });
        await expect(adapter.open({ handshake: createHandshake() })).rejects.toMatchObject({
            code: 'transport_identity_mismatch',
        });
        expect(closedStreams).toEqual(['stream']);
    });

    it('derives initiator/acceptor roles from the signed relationship and rejects a local mismatch', async () => {
        const acceptor = createRecordingAdapter({
            machineId: SOURCE_MACHINE_ID,
            localEndpointId: SOURCE_ENDPOINT_ID,
            role: 'acceptor',
        });
        await expect(acceptor.adapter.open({ handshake: createHandshake() }))
            .rejects.toMatchObject({ code: 'handshake_role_mismatch' });
        expect(acceptor.connectInputs).toEqual([]);

        const initiator = createRecordingAdapter({
            machineId: SOURCE_MACHINE_ID,
            localEndpointId: SOURCE_ENDPOINT_ID,
            role: 'initiator',
        });
        await expect(initiator.adapter.open({ handshake: createHandshake({ initiatorKind: 'account_client' }) }))
            .rejects.toMatchObject({ code: 'handshake_local_machine_mismatch' });
        expect(initiator.connectInputs).toEqual([]);

        const targetConfiguredAsInitiator = createRecordingAdapter({ role: 'initiator' });
        await expect(targetConfiguredAsInitiator.adapter.open({ handshake: createHandshake() }))
            .rejects.toMatchObject({ code: 'handshake_role_mismatch' });
        expect(targetConfiguredAsInitiator.connectInputs).toEqual([]);
    });

    it('fails closed when the handshake does not bind the local machine, endpoint, or account', async () => {
        const machine = createRecordingAdapter();
        await expect(machine.adapter.open({ handshake: createHandshake({ targetMachineId: 'machine-3' }) }))
            .rejects.toMatchObject({ code: 'handshake_local_machine_mismatch' });

        const endpoint = createRecordingAdapter({ localEndpointId: 'd'.repeat(64) });
        await expect(endpoint.adapter.open({ handshake: createHandshake() }))
            .rejects.toMatchObject({ code: 'handshake_local_endpoint_mismatch' });

        const account = createRecordingAdapter({ accountId: 'account-2' });
        await expect(account.adapter.open({ handshake: createHandshake() }))
            .rejects.toMatchObject({ code: 'handshake_account_mismatch' });
    });

    it('fails closed on degenerate or inverted source/target orientation', async () => {
        const { adapter, connectInputs } = createRecordingAdapter();
        const valid = createHandshake();
        await expect(adapter.open({ handshake: {
            ...valid,
            target: { ...valid.target, machineId: SOURCE_MACHINE_ID },
        } }))
            .rejects.toMatchObject({ code: 'handshake_invalid' });
        await expect(adapter.open({ handshake: {
            ...valid,
            target: { ...valid.target, endpointId: SOURCE_ENDPOINT_ID },
        } }))
            .rejects.toMatchObject({ code: 'handshake_invalid' });
        expect(connectInputs).toEqual([]);
    });

    it('fails closed on wrong account, machine, endpoint, route, expiry, or proof before connecting', async () => {
        const valid = createHandshake();
        const withPayload = (payload: DirectRouteGrantPayloadV2) => ({
            ...valid,
            grant: { ...valid.grant, payload },
        });
        const cases: ReadonlyArray<[unknown, string, number?]> = [
            [withPayload({ ...valid.grant.payload, accountId: 'account-2' }), 'handshake_invalid'],
            [withPayload({ ...valid.grant.payload, machineId: 'machine-9' }), 'handshake_invalid'],
            [withPayload({ ...valid.grant.payload, routeKind: 'loopback_direct', iroh: undefined }), 'handshake_invalid'],
            [withPayload({ ...valid.grant.payload, endpointFingerprint: 'e'.repeat(64) }), 'handshake_invalid'],
            [createHandshake({ grantOverrides: { exp: 2_000 } }), 'grant_expired'],
            [createHandshake({ breakProof: true }), 'proof_bad_signature'],
            [withPayload({ ...valid.grant.payload, routeKind: 'server_relay' as 'iroh_peer' }), 'handshake_invalid'],
        ];
        for (const [handshake, code, atMs] of cases) {
            const { adapter, connectInputs } = createRecordingAdapter({ nowMs: atMs ?? 2_000 });
            await expect(adapter.open({ handshake }))
                .rejects.toMatchObject({ code });
            expect(connectInputs).toEqual([]);
        }
    });

    it('fails closed on flow and operation mismatches before connecting', async () => {
        const { adapter, connectInputs } = createRecordingAdapter();
        const valid = createHandshake();
        await expect(adapter.open({ handshake: {
            ...valid,
            grant: { ...valid.grant, payload: {
                ...valid.grant.payload,
                flowKind: 'machine_rpc',
                scope: {
                    kind: 'machine_rpc',
                    rpcScopeId: OPERATION_ID,
                    allowedMethods: ['transfer.open'],
                    maxCalls: 1,
                    maxIdleMs: 1_000,
                },
            } },
        } })).rejects.toMatchObject({ code: 'handshake_invalid' });
        await expect(adapter.open({ handshake: {
            ...valid,
            flow: 'workspace_sync',
            grant: { ...valid.grant, payload: {
                ...valid.grant.payload,
                flowKind: 'tcp_tunnel',
                scope: {
                    kind: 'tcp_tunnel',
                    tunnelId: 'tunnel-1',
                    allowedPorts: [8080],
                    maxIdleMs: 1_000,
                    maxDurationMs: 1_000,
                },
            } },
        } })).rejects.toMatchObject({ code: 'handshake_invalid' });
        await expect(adapter.open({ handshake: createHandshake({ operationId: 'operation-2' }) }))
            .rejects.toMatchObject({ code: 'handshake_invalid' });
        expect(connectInputs).toEqual([]);
    });
});
