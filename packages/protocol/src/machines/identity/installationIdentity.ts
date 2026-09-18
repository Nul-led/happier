import { z } from 'zod';

import { decodeBase64, encodeBase64 } from '../../crypto/base64.js';
import {
    ED25519_PUBLIC_KEY_BYTES,
    ED25519_SECRET_KEY_BYTES,
    ED25519_SIGNATURE_BYTES,
    isValidEd25519PublicKey,
    signEd25519Message,
    verifyEd25519Signature,
} from '../../crypto/ed25519.js';
import { MachineReplacementReasonSchema } from './machineReplacement.js';
import {
    ContentPublicKeyFingerprintSchema,
    computeContentPublicKeyFingerprint,
} from './contentPublicKeyFingerprint.js';
export {
    ContentPublicKeyFingerprintSchema,
    computeContentPublicKeyFingerprint,
    type ContentPublicKeyFingerprint,
} from './contentPublicKeyFingerprint.js';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function validateBase64UrlEncodedBytes(
    value: string,
    fieldName: string,
    expectedLength: number,
    ctx: z.RefinementCtx,
    path: ReadonlyArray<string | number> = [],
): void {
    if (!BASE64URL_PATTERN.test(value)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path],
            message: `${fieldName} must use unpadded base64url encoding`,
        });
        return;
    }

    try {
        const bytes = decodeBase64(value, 'base64url');
        if (bytes.length !== expectedLength) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path],
                message: `${fieldName} must decode to ${expectedLength} bytes`,
            });
        }
    } catch {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path],
            message: `${fieldName} must be base64url-encoded key material`,
        });
    }
}

export const MachineInstallationPublicKeySchema = z.string().trim().min(1)
    .superRefine((value, ctx) => {
        validateBase64UrlEncodedBytes(value, 'installationPublicKey', ED25519_PUBLIC_KEY_BYTES, ctx);
        try {
            if (!isValidEd25519PublicKey(decodeBase64(value, 'base64url'))) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Ed25519 installation public key' });
            }
        } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Ed25519 installation public key' });
        }
    });

export const MachineInstallationPrivateKeySchema = z.string().trim().min(1)
    .superRefine((value, ctx) => {
        validateBase64UrlEncodedBytes(value, 'privateKey', ED25519_SECRET_KEY_BYTES, ctx);
    });

export const MachineInstallationProofSignatureSchema = z.string().trim().min(1)
    .superRefine((value, ctx) => {
        validateBase64UrlEncodedBytes(value, 'signature', ED25519_SIGNATURE_BYTES, ctx);
    });

export const MachineInstallationIdentityV1Schema = z.object({
    version: z.literal(1),
    installationId: z.string().trim().min(1),
    createdAt: z.number().int().nonnegative(),
    publicKey: MachineInstallationPublicKeySchema,
    privateKey: z.string().trim().min(1),
}).superRefine((identity, ctx) => {
    validateBase64UrlEncodedBytes(identity.privateKey, 'privateKey', ED25519_SECRET_KEY_BYTES, ctx, ['privateKey']);
});

export type MachineInstallationIdentityV1 = z.infer<typeof MachineInstallationIdentityV1Schema>;

export const MachineInstallationProofPayloadV1Schema = z.object({
    version: z.literal(1),
    installationId: z.string().trim().min(1),
    machineId: z.string().trim().min(1),
    replacesMachineId: z.string().trim().min(1).optional(),
    replacementReason: MachineReplacementReasonSchema.optional(),
    contentPublicKeyFingerprint: ContentPublicKeyFingerprintSchema.optional(),
    accountId: z.string().trim().min(1).optional(),
});

export type MachineInstallationProofPayloadV1 = z.infer<typeof MachineInstallationProofPayloadV1Schema>;

export const MachineInstallationProofV1Schema = z.object({
    version: z.literal(1),
    algorithm: z.literal('ed25519'),
    signature: MachineInstallationProofSignatureSchema,
});

export type MachineInstallationProofV1 = z.infer<typeof MachineInstallationProofV1Schema>;

function encodeUtf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function normalizeProofPayload(
    payload: MachineInstallationProofPayloadV1,
): MachineInstallationProofPayloadV1 {
    return MachineInstallationProofPayloadV1Schema.parse(payload);
}

export function buildMachineInstallationProofPayloadBytes(
    payload: MachineInstallationProofPayloadV1,
): Uint8Array {
    const normalized = normalizeProofPayload(payload);
    return encodeUtf8(JSON.stringify({
        version: normalized.version,
        installationId: normalized.installationId,
        machineId: normalized.machineId,
        ...(normalized.replacesMachineId ? { replacesMachineId: normalized.replacesMachineId } : null),
        ...(normalized.replacementReason ? { replacementReason: normalized.replacementReason } : null),
        ...(normalized.contentPublicKeyFingerprint
            ? { contentPublicKeyFingerprint: normalized.contentPublicKeyFingerprint }
            : null),
        ...(normalized.accountId ? { accountId: normalized.accountId } : null),
    }));
}

export function signMachineInstallationProof(params: Readonly<{
    payload: MachineInstallationProofPayloadV1;
    privateKey: string | Uint8Array;
}>): MachineInstallationProofV1 {
    const privateKeyBytes = typeof params.privateKey === 'string'
        ? decodeBase64(MachineInstallationPrivateKeySchema.parse(params.privateKey), 'base64url')
        : params.privateKey;
    if (privateKeyBytes.length !== ED25519_SECRET_KEY_BYTES) {
        throw new Error(`Invalid installation private key length: expected ${ED25519_SECRET_KEY_BYTES} bytes`);
    }
    const signature = signEd25519Message(
        buildMachineInstallationProofPayloadBytes(params.payload),
        privateKeyBytes,
    );
    return {
        version: 1,
        algorithm: 'ed25519',
        signature: encodeBase64(signature, 'base64url'),
    };
}

export function verifyMachineInstallationProof(params: Readonly<{
    payload: MachineInstallationProofPayloadV1;
    proof: MachineInstallationProofV1;
    publicKey: string | Uint8Array;
}>): boolean {
    const proof = MachineInstallationProofV1Schema.safeParse(params.proof);
    if (!proof.success) return false;

    let publicKeyBytes: Uint8Array;
    let signatureBytes: Uint8Array;
    try {
        publicKeyBytes = typeof params.publicKey === 'string'
            ? decodeBase64(MachineInstallationPublicKeySchema.parse(params.publicKey), 'base64url')
            : params.publicKey;
        signatureBytes = decodeBase64(proof.data.signature, 'base64url');
    } catch {
        return false;
    }

    if (publicKeyBytes.length !== ED25519_PUBLIC_KEY_BYTES) return false;
    if (signatureBytes.length !== ED25519_SIGNATURE_BYTES) return false;

    try {
        return verifyEd25519Signature(
            buildMachineInstallationProofPayloadBytes(params.payload),
            signatureBytes,
            publicKeyBytes,
        );
    } catch {
        return false;
    }
}
