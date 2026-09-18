import tweetnacl from 'tweetnacl';
import {
    SignedDirectRouteGrantV1Schema,
    SignedDirectRouteGrantV2Schema,
    PeerRouteNonceProofV1Schema,
    createDirectRouteGrantSigningInputV1,
    createDirectRouteGrantSigningInputV2,
    createPeerRouteNonceSigningInputV1,
    verifyPeerRouteEphemeralProofV2,
    type AuthorizedPeerEndpointRouteKindV1,
    type IrohPeerRouteBindingV2,
    type PeerFlowKindV1,
    type SignedDirectRouteGrantV1,
    type SignedDirectRouteGrantV2,
    type PeerRouteNonceProofV1,
} from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { decodeRouteGrantBase64Url as fromBase64Url, findRouteGrantTrustRoot as findTrustRoot, verifyRouteGrantSignature, type DirectRouteGrantTrustRoot } from './verifyRouteGrantSignature';

export type DirectRouteGrantVerifyReasonCode =
    | 'grant_invalid'
    | 'grant_unknown_key'
    | 'grant_bad_signature'
    | 'grant_expired'
    | 'grant_not_yet_valid'
    | 'grant_revoked'
    | 'grant_account_mismatch'
    | 'grant_machine_mismatch'
    | 'grant_flow_mismatch'
    | 'grant_route_mismatch'
    | 'grant_endpoint_mismatch'
    | 'grant_iroh_binding_mismatch';

export type DirectRouteGrantVerificationResult =
    | Readonly<{ valid: true; payload: SignedDirectRouteGrantV1['payload']; receipt: 'peer.route_grant.verified' }>
    | Readonly<{ valid: false; reasonCode: DirectRouteGrantVerifyReasonCode; receipt?: 'peer.route_grant.rejected' }>;

export type DirectRouteGrantV2VerifyReasonCode = DirectRouteGrantVerifyReasonCode
    | 'proof_invalid'
    | 'proof_grant_invalid'
    | 'proof_grant_digest_mismatch'
    | 'proof_bad_signature';

export type DirectRouteGrantV2VerificationResult =
    | Readonly<{ valid: true; payload: SignedDirectRouteGrantV2['payload']; receipt: 'peer.route_grant.verified' }>
    | Readonly<{ valid: false; reasonCode: DirectRouteGrantV2VerifyReasonCode; receipt?: 'peer.route_grant.rejected' }>;

export type PeerRouteNonceVerifyReasonCode =
    | 'nonce_invalid'
    | 'nonce_binding_mismatch'
    | 'nonce_bad_signature';

export type PeerRouteNonceVerificationResult =
    | Readonly<{ valid: true }>
    | Readonly<{ valid: false; reasonCode: PeerRouteNonceVerifyReasonCode }>;

export type { DirectRouteGrantTrustRoot } from './verifyRouteGrantSignature';

/** Full signed machine/1 initiator/target relationship expected for `iroh_peer` admissions. */
export type DirectRouteGrantIrohExpectedBinding = IrohPeerRouteBindingV2;

export type DirectRouteGrantExpectedBinding = Readonly<{
    accountId: string;
    machineId: string;
    flowKind: PeerFlowKindV1;
    routeKind: AuthorizedPeerEndpointRouteKindV1;
    endpointFingerprint?: string;
    /**
     * Required when `routeKind` is `iroh_peer` and forbidden otherwise: the full signed machine/1
     * relationship. The target daemon supplies its current Machine and Endpoint identities;
     * authenticated Account clients have no synthetic source Machine identity.
     */
    iroh?: DirectRouteGrantIrohExpectedBinding;
}>;

function matchesExpectedBinding(
    payload: SignedDirectRouteGrantV1['payload'] | SignedDirectRouteGrantV2['payload'],
    expected: DirectRouteGrantExpectedBinding,
): DirectRouteGrantVerifyReasonCode | null {
    if (payload.accountId !== expected.accountId) return 'grant_account_mismatch';
    if (payload.machineId !== expected.machineId) return 'grant_machine_mismatch';
    if (payload.flowKind !== expected.flowKind) return 'grant_flow_mismatch';
    if (payload.routeKind !== expected.routeKind) return 'grant_route_mismatch';
    if (expected.endpointFingerprint && payload.endpointFingerprint !== expected.endpointFingerprint) {
        return 'grant_endpoint_mismatch';
    }
    if (expected.routeKind === 'iroh_peer' || expected.iroh) {
        const grantIroh = 'iroh' in payload ? payload.iroh : undefined;
        if (
            !expected.iroh
            || !grantIroh
            || grantIroh.initiator.kind !== expected.iroh.initiator.kind
            || grantIroh.initiator.endpointId !== expected.iroh.initiator.endpointId
            || (
                grantIroh.initiator.kind === 'machine'
                && (
                    expected.iroh.initiator.kind !== 'machine'
                    || grantIroh.initiator.machineId !== expected.iroh.initiator.machineId
                )
            )
            || grantIroh.target.machineId !== expected.iroh.target.machineId
            || grantIroh.target.endpointId !== expected.iroh.target.endpointId
            || grantIroh.operationKind !== expected.iroh.operationKind
        ) {
            return 'grant_iroh_binding_mismatch';
        }
    }
    return null;
}

export function verifyDirectRouteGrantV2(input: Readonly<{
    grant: unknown;
    proof: unknown;
    trustRoots: readonly DirectRouteGrantTrustRoot[];
    nowMs: number;
    expected: DirectRouteGrantExpectedBinding;
}>): DirectRouteGrantV2VerificationResult {
    const parsed = SignedDirectRouteGrantV2Schema.safeParse(input.grant);
    if (!parsed.success) return { valid: false, reasonCode: 'grant_invalid', receipt: 'peer.route_grant.rejected' };

    const grant = parsed.data;
    const publicKey = findTrustRoot(input.trustRoots, grant.signature.keyId, input.nowMs);
    if (!publicKey) return { valid: false, reasonCode: 'grant_unknown_key' };
    if (input.nowMs >= grant.payload.exp) return { valid: false, reasonCode: 'grant_expired' };
    if (input.nowMs < grant.payload.iat) return { valid: false, reasonCode: 'grant_not_yet_valid' };

    const bindingMismatch = matchesExpectedBinding(grant.payload, input.expected);
    if (bindingMismatch) return { valid: false, reasonCode: bindingMismatch };
    if (!verifyRouteGrantSignature({ signingInput: createDirectRouteGrantSigningInputV2(grant.payload), signatureBase64Url: grant.signature.valueBase64Url, publicKey })) {
        return { valid: false, reasonCode: 'grant_bad_signature' };
    }
    const proofVerification = verifyPeerRouteEphemeralProofV2({ grant, proof: input.proof });
    if (!proofVerification.valid) return proofVerification;
    return { valid: true, payload: grant.payload, receipt: 'peer.route_grant.verified' };
}

export function verifyDirectRouteGrantV1(input: Readonly<{
    grant: unknown;
    trustRoots: readonly DirectRouteGrantTrustRoot[];
    nowMs: number;
    expected: DirectRouteGrantExpectedBinding;
}>): DirectRouteGrantVerificationResult {
    const parsed = SignedDirectRouteGrantV1Schema.safeParse(input.grant);
    if (!parsed.success) return { valid: false, reasonCode: 'grant_invalid', receipt: 'peer.route_grant.rejected' };

    const grant = parsed.data;
    const publicKey = findTrustRoot(input.trustRoots, grant.signature.keyId, input.nowMs);
    if (!publicKey) return { valid: false, reasonCode: 'grant_unknown_key' };

    if (input.nowMs >= grant.payload.exp) return { valid: false, reasonCode: 'grant_expired' };
    if (input.nowMs < grant.payload.iat) return { valid: false, reasonCode: 'grant_not_yet_valid' };


    const bindingMismatch = matchesExpectedBinding(grant.payload, input.expected);
    if (bindingMismatch) return { valid: false, reasonCode: bindingMismatch };

    if (!verifyRouteGrantSignature({ signingInput: createDirectRouteGrantSigningInputV1(grant.payload), signatureBase64Url: grant.signature.valueBase64Url, publicKey })) {
        return { valid: false, reasonCode: 'grant_bad_signature' };
    }

    return { valid: true, payload: grant.payload, receipt: 'peer.route_grant.verified' };
}

export function createPeerRouteNonceProofV1(input: Readonly<{
    grantId: string;
    routeKind: AuthorizedPeerEndpointRouteKindV1;
    flowKind: PeerFlowKindV1;
    endpointFingerprint?: string;
    nonceBase64Url: string;
    accountSigningSeed: Uint8Array;
}>): PeerRouteNonceProofV1 {
    const keyPair = tweetnacl.sign.keyPair.fromSeed(input.accountSigningSeed);
    const signingInput = Buffer.from(createPeerRouteNonceSigningInputV1(input), 'utf8');
    return {
        v: 1,
        grantId: input.grantId,
        routeKind: input.routeKind,
        flowKind: input.flowKind,
        ...(input.endpointFingerprint ? { endpointFingerprint: input.endpointFingerprint } : {}),
        nonceBase64Url: input.nonceBase64Url,
        signatureBase64Url: Buffer.from(tweetnacl.sign.detached(signingInput, keyPair.secretKey)).toString('base64url'),
    };
}

export function verifyPeerRouteNonceV1(input: Readonly<{
    proof: unknown;
    accountPublicKey: string;
    expected: Readonly<{
        grantId: string;
        routeKind: AuthorizedPeerEndpointRouteKindV1;
        flowKind: PeerFlowKindV1;
        endpointFingerprint?: string;
    }>;
}>): PeerRouteNonceVerificationResult {
    const parsed = PeerRouteNonceProofV1Schema.safeParse(input.proof);
    if (!parsed.success) return { valid: false, reasonCode: 'nonce_invalid' };
    const proof = parsed.data;

    // An iroh_peer nonce must link the grant's target endpoint fingerprint; without an expected
    // fingerprint the proof does not link to the signed machine/1 binding at all.
    if (input.expected.routeKind === 'iroh_peer' && !input.expected.endpointFingerprint) {
        return { valid: false, reasonCode: 'nonce_binding_mismatch' };
    }

    if (
        proof.grantId !== input.expected.grantId
        || proof.routeKind !== input.expected.routeKind
        || proof.flowKind !== input.expected.flowKind
        || (input.expected.endpointFingerprint && proof.endpointFingerprint !== input.expected.endpointFingerprint)
    ) {
        return { valid: false, reasonCode: 'nonce_binding_mismatch' };
    }

    const publicKey = fromBase64Url(input.accountPublicKey);
    const signature = fromBase64Url(proof.signatureBase64Url);
    if (!publicKey || publicKey.length !== tweetnacl.sign.publicKeyLength || !signature || signature.length !== tweetnacl.sign.signatureLength) {
        return { valid: false, reasonCode: 'nonce_invalid' };
    }

    const signingInput = Buffer.from(createPeerRouteNonceSigningInputV1(proof), 'utf8');
    if (!tweetnacl.sign.detached.verify(signingInput, signature, publicKey)) {
        return { valid: false, reasonCode: 'nonce_bad_signature' };
    }

    return { valid: true };
}

export function resolvePeerRouteNonceSigningSeedFromCredentials(
    credentials: Credentials,
): Readonly<
    | { ok: true; seed: Uint8Array }
    | { ok: false; reasonCode: 'account_signing_key_unavailable_for_credential_mode' }
> {
    if (credentials.encryption.type === 'legacy') {
        return { ok: true, seed: credentials.encryption.secret };
    }
    return { ok: false, reasonCode: 'account_signing_key_unavailable_for_credential_mode' };
}
