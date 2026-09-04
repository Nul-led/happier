import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
    createDirectRouteGrantSigningInputV1,
    createDirectRouteGrantSigningInputV2,
    createEphemeralPeerRouteProofHandleV2,
    type DirectRouteGrantPayloadV1,
    type DirectRouteGrantPayloadV2,
} from '@happier-dev/protocol';

import {
    createPeerRouteNonceProofV1,
    resolvePeerRouteNonceSigningSeedFromCredentials,
    verifyDirectRouteGrantV1,
    verifyDirectRouteGrantV2,
    verifyPeerRouteNonceV1,
} from './verifyDirectRouteGrantV1';

function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

const signingSeed = new Uint8Array(32).fill(7);
const signingKeyPair = tweetnacl.sign.keyPair.fromSeed(signingSeed);
const accountSeed = new Uint8Array(32).fill(9);
const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(accountSeed);

const payload: DirectRouteGrantPayloadV1 = {
    v: 1,
    grantId: 'grant_1',
    grantFamilyId: 'family_1',
    accountId: 'account_1',
    machineId: 'machine_1',
    flowKind: 'bounded_transfer',
    routeKind: 'loopback_direct',
    scope: {
        kind: 'bounded_transfer',
        mode: 'single',
        transferId: 'transfer_1',
        maxBytes: 1024,
    },
    iat: 1_000,
    exp: 601_000,
    aud: 'happier-daemon-route-grant',
    endpointFingerprint: 'endpoint_1',
};

function createSignedGrant(overrides: Partial<DirectRouteGrantPayloadV1> = {}) {
    const nextPayload = { ...payload, ...overrides };
    const signingInput = Buffer.from(createDirectRouteGrantSigningInputV1(nextPayload), 'utf8');
    return {
        payload: nextPayload,
        signature: {
            keyId: 'key_1',
            alg: 'Ed25519',
            valueBase64Url: toBase64Url(tweetnacl.sign.detached(signingInput, signingKeyPair.secretKey)),
        },
    } as const;
}

describe('verifyDirectRouteGrantV1', () => {
    it('rejects V1 iroh_peer grants before signature admission', () => {
        const invalidIrohGrant = {
            ...createSignedGrant(),
            payload: { ...payload, routeKind: 'iroh_peer' },
        };
        expect(verifyDirectRouteGrantV1({
            grant: invalidIrohGrant,
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: {
                accountId: 'account_1',
                machineId: 'machine_1',
                flowKind: 'bounded_transfer',
                routeKind: 'iroh_peer',
            },
        })).toEqual({ valid: false, reasonCode: 'grant_invalid', receipt: 'peer.route_grant.rejected' });
    });

    it('rejects a signed server_relay grant at the endpoint verifier', () => {
        const validGrant = createSignedGrant();
        expect(verifyDirectRouteGrantV1({
            grant: {
                ...validGrant,
                payload: { ...validGrant.payload, routeKind: 'server_relay' },
            },
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: {
                accountId: 'account_1',
                machineId: 'machine_1',
                flowKind: 'bounded_transfer',
                routeKind: 'loopback_direct',
            },
        })).toEqual({ valid: false, reasonCode: 'grant_invalid', receipt: 'peer.route_grant.rejected' });
    });

    it('verifies signature, audience, expiry, endpoint, and expected route binding', () => {
        expect(verifyDirectRouteGrantV1({
            grant: createSignedGrant(),
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: {
                accountId: 'account_1',
                machineId: 'machine_1',
                flowKind: 'bounded_transfer',
                routeKind: 'loopback_direct',
                endpointFingerprint: 'endpoint_1',
            },
        })).toEqual(expect.objectContaining({
            valid: true,
        }));
    });

    it('rejects key, signature, expiry, audience, and endpoint mismatches with structured reasons', () => {
        expect(verifyDirectRouteGrantV1({
            grant: createSignedGrant(),
            trustRoots: [{
                keyId: 'key_1',
                publicKey: toBase64Url(signingKeyPair.publicKey),
                expiresAt: 2_000,
            }],
            nowMs: 2_000,
            expected: { accountId: 'account_1', machineId: 'machine_1', flowKind: 'bounded_transfer', routeKind: 'loopback_direct' },
        })).toEqual({ valid: false, reasonCode: 'grant_unknown_key' });

        expect(verifyDirectRouteGrantV1({
            grant: createSignedGrant(),
            trustRoots: [{ keyId: 'other_key', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: { accountId: 'account_1', machineId: 'machine_1', flowKind: 'bounded_transfer', routeKind: 'loopback_direct' },
        })).toEqual({ valid: false, reasonCode: 'grant_unknown_key' });

        expect(verifyDirectRouteGrantV1({
            grant: createSignedGrant({ exp: 2_000 }),
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_001,
            expected: { accountId: 'account_1', machineId: 'machine_1', flowKind: 'bounded_transfer', routeKind: 'loopback_direct' },
        })).toEqual({ valid: false, reasonCode: 'grant_expired' });

        expect(verifyDirectRouteGrantV1({
            grant: createSignedGrant({ exp: 2_000 }),
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: { accountId: 'account_1', machineId: 'machine_1', flowKind: 'bounded_transfer', routeKind: 'loopback_direct' },
        })).toEqual({ valid: false, reasonCode: 'grant_expired' });

        expect(verifyDirectRouteGrantV1({
            grant: createSignedGrant({ endpointFingerprint: 'endpoint_2' }),
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: {
                accountId: 'account_1',
                machineId: 'machine_1',
                flowKind: 'bounded_transfer',
                routeKind: 'loopback_direct',
                endpointFingerprint: 'endpoint_1',
            },
        })).toEqual({ valid: false, reasonCode: 'grant_endpoint_mismatch' });
    });
});

describe('verifyDirectRouteGrantV2', () => {
    function createV2GrantAndProof(overrides: Partial<DirectRouteGrantPayloadV2> = {}) {
        const handle = createEphemeralPeerRouteProofHandleV2({
            randomBytes: (length) => new Uint8Array(length).fill(length === 32 ? 5 : 6),
        });
        const payloadV2: DirectRouteGrantPayloadV2 = {
            v: 2,
            grantId: 'grant_v2',
            grantFamilyId: 'family_v2',
            accountId: 'account_1',
            machineId: 'machine_1',
            flowKind: 'machine_rpc',
            routeKind: 'loopback_direct',
            scope: {
                kind: 'machine_rpc',
                rpcScopeId: 'rpc_1',
                allowedMethods: ['daemon.memory.status'],
                maxCalls: 1,
                maxIdleMs: 1_000,
            },
            iat: 1_000,
            exp: 61_000,
            aud: 'happier-daemon-route-grant',
            endpointFingerprint: 'endpoint_1',
            proofKind: 'ephemeral_ed25519',
            ephemeralPublicKeyBase64Url: handle.publicKeyBase64Url,
            ...overrides,
        };
        const grant = {
            payload: payloadV2,
            signature: {
                keyId: 'key_1',
                alg: 'Ed25519' as const,
                valueBase64Url: toBase64Url(tweetnacl.sign.detached(
                    Buffer.from(createDirectRouteGrantSigningInputV2(payloadV2), 'utf8'),
                    signingKeyPair.secretKey,
                )),
            },
        };
        return { grant, proof: handle.sign(grant) };
    }

    it('verifies server signature, complete binding, digest, nonce, and ephemeral possession', () => {
        const { grant, proof } = createV2GrantAndProof();
        expect(verifyDirectRouteGrantV2({
            grant,
            proof,
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: {
                accountId: 'account_1',
                machineId: 'machine_1',
                flowKind: 'machine_rpc',
                routeKind: 'loopback_direct',
                endpointFingerprint: 'endpoint_1',
            },
        })).toEqual(expect.objectContaining({ valid: true }));
    });

    it('requires the full signed Iroh relationship when V2 admits machine/1', () => {
        const sourceEndpointId = 'a'.repeat(64);
        const targetEndpointId = 'b'.repeat(64);
        const iroh = {
            initiator: {
                kind: 'account_client' as const,
                endpointId: sourceEndpointId,
            },
            target: {
                machineId: 'machine_target',
                endpointId: targetEndpointId,
            },
            operationKind: 'finite_transfer' as const,
        };
        const { grant, proof } = createV2GrantAndProof({
            machineId: iroh.target.machineId,
            flowKind: 'bounded_transfer',
            routeKind: 'iroh_peer',
            scope: { kind: 'bounded_transfer', mode: 'carrier' },
            endpointFingerprint: targetEndpointId,
            iroh,
        });
        const baseInput = {
            grant,
            proof,
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
        } as const;

        expect(verifyDirectRouteGrantV2({
            ...baseInput,
            expected: {
                accountId: 'account_1',
                machineId: iroh.target.machineId,
                flowKind: 'bounded_transfer',
                routeKind: 'iroh_peer',
                endpointFingerprint: targetEndpointId,
                iroh,
            },
        })).toEqual(expect.objectContaining({ valid: true }));
        expect(verifyDirectRouteGrantV2({
            ...baseInput,
            expected: {
                accountId: 'account_1',
                machineId: iroh.target.machineId,
                flowKind: 'bounded_transfer',
                routeKind: 'iroh_peer',
                endpointFingerprint: targetEndpointId,
            },
        })).toEqual({ valid: false, reasonCode: 'grant_iroh_binding_mismatch' });

        expect(verifyDirectRouteGrantV2({
            ...baseInput,
            expected: {
                accountId: 'account_1',
                machineId: iroh.target.machineId,
                flowKind: 'bounded_transfer',
                routeKind: 'iroh_peer',
                endpointFingerprint: 'c'.repeat(64),
                iroh: {
                    ...iroh,
                    target: { ...iroh.target, endpointId: 'c'.repeat(64) },
                },
            },
        })).toEqual({ valid: false, reasonCode: 'grant_endpoint_mismatch' });
    });

    it('rejects a V2 machine grant after its signing trust root expires', () => {
        const { grant, proof } = createV2GrantAndProof();
        expect(verifyDirectRouteGrantV2({
            grant,
            proof,
            trustRoots: [{
                keyId: 'key_1',
                publicKey: toBase64Url(signingKeyPair.publicKey),
                expiresAt: 2_000,
            }],
            nowMs: 2_000,
            expected: {
                accountId: 'account_1',
                machineId: 'machine_1',
                flowKind: 'machine_rpc',
                routeKind: 'loopback_direct',
                endpointFingerprint: 'endpoint_1',
            },
        })).toEqual({ valid: false, reasonCode: 'grant_unknown_key' });
    });

    it.each([
        ['accountId', 'other-account', 'grant_account_mismatch'],
        ['machineId', 'other-machine', 'grant_machine_mismatch'],
        ['flowKind', 'live_stream', 'grant_flow_mismatch'],
        ['routeKind', 'lan_direct', 'grant_route_mismatch'],
        ['endpointFingerprint', 'other-endpoint', 'grant_endpoint_mismatch'],
    ] as const)('rejects an altered %s binding before admission', (field, value, reasonCode) => {
        const { grant, proof } = createV2GrantAndProof();
        expect(verifyDirectRouteGrantV2({
            grant,
            proof,
            trustRoots: [{ keyId: 'key_1', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: {
                accountId: field === 'accountId' ? value : 'account_1',
                machineId: field === 'machineId' ? value : 'machine_1',
                flowKind: field === 'flowKind' ? value : 'machine_rpc',
                routeKind: field === 'routeKind' ? value : 'loopback_direct',
                endpointFingerprint: field === 'endpointFingerprint' ? value : 'endpoint_1',
            },
        })).toEqual({ valid: false, reasonCode });
    });

    it('rejects proof reuse against another signed grant digest', () => {
        const { grant, proof } = createV2GrantAndProof();
        const alteredGrant = {
            ...grant,
            signature: { ...grant.signature, keyId: 'other-key' },
        };
        expect(verifyDirectRouteGrantV2({
            grant: alteredGrant,
            proof,
            trustRoots: [{ keyId: 'other-key', publicKey: toBase64Url(signingKeyPair.publicKey) }],
            nowMs: 2_000,
            expected: {
                accountId: 'account_1', machineId: 'machine_1', flowKind: 'machine_rpc',
                routeKind: 'loopback_direct', endpointFingerprint: 'endpoint_1',
            },
        })).toEqual({ valid: false, reasonCode: 'proof_grant_digest_mismatch' });
    });
});

describe('verifyPeerRouteNonceV1', () => {
    it('binds peer nonce proof to grant, route, flow, and endpoint fingerprint', () => {
        const proof = createPeerRouteNonceProofV1({
            grantId: 'grant_1',
            routeKind: 'loopback_direct',
            flowKind: 'bounded_transfer',
            endpointFingerprint: 'endpoint_1',
            nonceBase64Url: toBase64Url(new Uint8Array(32).fill(3)),
            accountSigningSeed: accountSeed,
        });

        expect(verifyPeerRouteNonceV1({
            proof,
            accountPublicKey: toBase64Url(accountKeyPair.publicKey),
            expected: {
                grantId: 'grant_1',
                routeKind: 'loopback_direct',
                flowKind: 'bounded_transfer',
                endpointFingerprint: 'endpoint_1',
            },
        })).toEqual({ valid: true });

        expect(verifyPeerRouteNonceV1({
            proof,
            accountPublicKey: toBase64Url(accountKeyPair.publicKey),
            expected: {
                grantId: 'grant_1',
                routeKind: 'lan_direct',
                flowKind: 'bounded_transfer',
                endpointFingerprint: 'endpoint_1',
            },
        })).toEqual({ valid: false, reasonCode: 'nonce_binding_mismatch' });
    });

    it('links an iroh_peer nonce proof to the signed grant and its target endpoint fingerprint', () => {
        const proof = createPeerRouteNonceProofV1({
            grantId: 'grant_iroh_1',
            routeKind: 'iroh_peer',
            flowKind: 'bounded_transfer',
            endpointFingerprint: 'endpoint_target',
            nonceBase64Url: toBase64Url(new Uint8Array(32).fill(4)),
            accountSigningSeed: accountSeed,
        });

        expect(verifyPeerRouteNonceV1({
            proof,
            accountPublicKey: toBase64Url(accountKeyPair.publicKey),
            expected: {
                grantId: 'grant_iroh_1',
                routeKind: 'iroh_peer',
                flowKind: 'bounded_transfer',
                endpointFingerprint: 'endpoint_target',
            },
        })).toEqual({ valid: true });

        expect(verifyPeerRouteNonceV1({
            proof,
            accountPublicKey: toBase64Url(accountKeyPair.publicKey),
            expected: {
                grantId: 'grant_iroh_1',
                routeKind: 'iroh_peer',
                flowKind: 'bounded_transfer',
                endpointFingerprint: 'endpoint_other',
            },
        })).toEqual({ valid: false, reasonCode: 'nonce_binding_mismatch' });
    });

    it('requires an endpoint fingerprint expectation for iroh_peer nonce proofs', () => {
        const proof = createPeerRouteNonceProofV1({
            grantId: 'grant_iroh_1',
            routeKind: 'iroh_peer',
            flowKind: 'bounded_transfer',
            endpointFingerprint: 'endpoint_target',
            nonceBase64Url: toBase64Url(new Uint8Array(32).fill(4)),
            accountSigningSeed: accountSeed,
        });

        expect(verifyPeerRouteNonceV1({
            proof,
            accountPublicKey: toBase64Url(accountKeyPair.publicKey),
            expected: {
                grantId: 'grant_iroh_1',
                routeKind: 'iroh_peer',
                flowKind: 'bounded_transfer',
            },
        })).toEqual({ valid: false, reasonCode: 'nonce_binding_mismatch' });
    });

    it('only resolves nonce signing seed from legacy credentials', () => {
        expect(resolvePeerRouteNonceSigningSeedFromCredentials({
            token: 'token',
            encryption: { type: 'legacy', secret: accountSeed },
        })).toEqual({ ok: true, seed: accountSeed });

        expect(resolvePeerRouteNonceSigningSeedFromCredentials({
            token: 'token',
            encryption: {
                type: 'dataKey',
                publicKey: new Uint8Array(32),
                machineKey: new Uint8Array(32),
            },
        })).toEqual({
            ok: false,
            reasonCode: 'account_signing_key_unavailable_for_credential_mode',
        });
    });
});
