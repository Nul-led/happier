import { z } from 'zod';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

import {
  ACCOUNT_DIRECTORY_MAX_LABEL_UTF8_BYTES,
  HomeConnectionDescriptorV1Schema,
} from '../auth/accountDirectory.js';
import { decodeBase64, encodeBase64 } from './base64.js';
import { encodeCanonicalLengthDelimited } from './canonicalDigest.js';
import { createCanonicalJsonSigningInput } from './canonicalJson.js';

/**
 * Single canonical owner of the Home QR V2 invite payload, rendezvous/binding
 * derivations, binding proof, and confirmation code (lane-05 §6.2).
 *
 * One random 32-byte QR-only secret is domain separated into:
 *   rendezvousSecret = HMAC-SHA256(qrSecret, "happier/qr/rendezvous/v2")
 *   bindingKey       = HMAC-SHA256(qrSecret, "happier/qr/binding/v2")
 *
 * The relay sees only the SHA-256 verifier of the rendezvous secret; it never
 * receives the raw secret or the binding key, so it cannot derive the binding
 * proof or the client confirmation code. The JSON/base64url invite encoding is
 * implemented exactly once here; consumers must not hand-roll it.
 */

export const HOME_QR_RENDEZVOUS_DOMAIN_V2 = 'happier/qr/rendezvous/v2' as const;
export const HOME_QR_BINDING_DOMAIN_V2 = 'happier/qr/binding/v2' as const;

export const HOME_QR_SECRET_V2_BYTES = 32;
/** Requester X25519 box public key length bound into the proof and the sealed response. */
export const HOME_QR_REQUESTER_PUBLIC_KEY_V2_BYTES = 32;
/** Bounded invite lifetime; matches the existing pairing policy TTL clamp maximum (600s). */
export const HOME_QR_INVITE_V2_MAX_TTL_MS = 600_000;
/** Narrow clock tolerance for an invite issued slightly in the future. */
export const HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS = 30_000;
/** Bounded opaque payload budget for QR/deep-link carriers. */
export const HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES = 16 * 1024;

const HOME_QR_BINDING_PROTOCOL_VERSION_V2 = 'v2';
const HOME_QR_BINDING_INTENT_V2 = 'home_device';

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export const HomeQrInviteV2Schema = z.object({
  v: z.literal(2),
  intent: z.literal('home_device'),
  pairId: z.string().min(1).max(128).superRefine((value, context) => {
    if (UTF8_ENCODER.encode(value).byteLength > 128) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Pair ID exceeds its UTF-8 byte limit' });
    }
  }),
  home: HomeConnectionDescriptorV1Schema,
  qrSecretBase64Url: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(64),
  issuedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  requestedDeviceLabel: z.string().min(1).superRefine((value, context) => {
    if (UTF8_ENCODER.encode(value).byteLength > ACCOUNT_DIRECTORY_MAX_LABEL_UTF8_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Requested device label exceeds its UTF-8 byte limit' });
    }
  }).optional(),
}).strict().superRefine((value, context) => {
  try {
    const secretBytes = decodeBase64(value.qrSecretBase64Url, 'base64url');
    if (secretBytes.length !== HOME_QR_SECRET_V2_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'QR secret must be 32 bytes' });
    } else if (encodeBase64(secretBytes, 'base64url') !== value.qrSecretBase64Url) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'QR secret must be canonical base64url' });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid QR secret' });
  }
  if (value.expiresAtMs <= value.issuedAtMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid invite expiry' });
  } else if (value.expiresAtMs - value.issuedAtMs > HOME_QR_INVITE_V2_MAX_TTL_MS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invite TTL exceeds the pairing maximum' });
  }
});
export type HomeQrInviteV2 = z.infer<typeof HomeQrInviteV2Schema>;

export type HomeQrBindingContextV2 = Readonly<{
  pairId: string;
  homeServerIdentityId: string;
  requesterPublicKey: Uint8Array;
  expiresAtMs: number;
}>;

export type HomeQrBindingParamsV2 = Readonly<HomeQrBindingContextV2 & {
  qrSecret: Uint8Array;
}>;

function assertQrSecretV2(qrSecret: Uint8Array): void {
  if (qrSecret.length !== HOME_QR_SECRET_V2_BYTES) throw new Error('QR secret must be 32 bytes');
}

function assertHomeQrBindingContextV2(context: HomeQrBindingContextV2): void {
  if (context.requesterPublicKey.length !== HOME_QR_REQUESTER_PUBLIC_KEY_V2_BYTES) {
    throw new Error('Requester X25519 box public key must be 32 bytes');
  }
  if (!Number.isSafeInteger(context.expiresAtMs) || context.expiresAtMs < 0) {
    throw new Error('Invalid invite expiry timestamp');
  }
}

/**
 * Canonical binding input, length-delimited in this exact conceptual order:
 * protocol version, intent, pairId, target homeServerIdentityId, requester
 * X25519 box public key (exactly 32 bytes), expiresAtMs.
 */
export function createHomeQrBindingInputV2(context: HomeQrBindingContextV2): Uint8Array {
  assertHomeQrBindingContextV2(context);
  return encodeCanonicalLengthDelimited([
    HOME_QR_BINDING_PROTOCOL_VERSION_V2,
    HOME_QR_BINDING_INTENT_V2,
    context.pairId,
    context.homeServerIdentityId,
    context.requesterPublicKey,
    String(context.expiresAtMs),
  ]);
}

export function deriveHomeQrRendezvousSecretV2(qrSecret: Uint8Array): Uint8Array {
  assertQrSecretV2(qrSecret);
  return hmac(sha256, qrSecret, UTF8_ENCODER.encode(HOME_QR_RENDEZVOUS_DOMAIN_V2));
}

export function deriveHomeQrBindingKeyV2(qrSecret: Uint8Array): Uint8Array {
  assertQrSecretV2(qrSecret);
  return hmac(sha256, qrSecret, UTF8_ENCODER.encode(HOME_QR_BINDING_DOMAIN_V2));
}

/**
 * Verifier handed to the relay for the pending pairing row: a plain SHA-256
 * of the high-entropy rendezvous secret. The relay can match the row without
 * learning the secret and can never derive the binding key from it.
 */
export function deriveHomeQrRendezvousVerifierV2(qrSecret: Uint8Array): Uint8Array {
  return sha256(deriveHomeQrRendezvousSecretV2(qrSecret));
}

function equalBytesConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

/** Verifies the already-derived rendezvous secret sent by the joining client. */
export function verifyHomeQrRendezvousSecretV2(
  rendezvousSecret: Uint8Array,
  verifier: Uint8Array,
): boolean {
  if (rendezvousSecret.length !== HOME_QR_SECRET_V2_BYTES || verifier.length !== HOME_QR_SECRET_V2_BYTES) {
    return false;
  }
  return equalBytesConstantTime(sha256(rendezvousSecret), verifier);
}

function computeHomeQrBindingProofBytesV2(params: HomeQrBindingParamsV2): Uint8Array {
  assertQrSecretV2(params.qrSecret);
  return hmac(sha256, deriveHomeQrBindingKeyV2(params.qrSecret), createHomeQrBindingInputV2(params));
}

/** Canonical base64url binding proof over the canonical binding input. */
export function computeHomeQrBindingProofV2(params: HomeQrBindingParamsV2): string {
  return encodeBase64(computeHomeQrBindingProofBytesV2(params), 'base64url');
}

/** Constant-time verification; rejects noncanonical or wrong-length proof encodings. */
export function verifyHomeQrBindingProofV2(params: HomeQrBindingParamsV2, proofBase64Url: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(proofBase64Url)) return false;
  try {
    const proofBytes = decodeBase64(proofBase64Url, 'base64url');
    if (proofBytes.length !== 32) return false;
    if (encodeBase64(proofBytes, 'base64url') !== proofBase64Url) return false;
    return equalBytesConstantTime(proofBytes, computeHomeQrBindingProofBytesV2(params));
  } catch {
    return false;
  }
}

/** Constant-time verifier check against a stored relay verifier. */
export function verifyHomeQrRendezvousVerifierV2(qrSecret: Uint8Array, verifier: Uint8Array): boolean {
  try {
    return verifyHomeQrRendezvousSecretV2(deriveHomeQrRendezvousSecretV2(qrSecret), verifier);
  } catch {
    return false;
  }
}

/**
 * Fixed six-digit zero-padded confirmation code from the same canonical
 * binding input and binding key. Both clients compute it locally; it is
 * informational human verification, never the authorization primitive.
 */
export function computeHomeQrConfirmationCodeV2(params: HomeQrBindingParamsV2): string {
  const digest = computeHomeQrBindingProofBytesV2(params);
  const value = new DataView(digest.buffer, digest.byteOffset).getUint32(0, false) % 1_000_000;
  return String(value).padStart(6, '0');
}

/**
 * Canonical deterministic invite encoding: strict schema validation, canonical
 * JSON key order, bounded payload, unpadded base64url. Throws on invalid
 * producers (caller-owned invite construction) and oversized payloads.
 */
export function encodeHomeQrInviteV2Payload(invite: HomeQrInviteV2): string {
  const parsed = HomeQrInviteV2Schema.parse(invite);
  const bytes = UTF8_ENCODER.encode(createCanonicalJsonSigningInput(parsed));
  if (bytes.byteLength > HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES) {
    throw new Error('Home QR invite payload exceeds its size limit');
  }
  return encodeBase64(bytes, 'base64url');
}

/**
 * Strict opaque-payload parse for happier:// link consumers. Rejects
 * noncanonical base64url, noncanonical JSON byte forms, unknown/missing/
 * invalid fields, oversized payloads, and non-fresh invites. Returns null on
 * every failure; never throws, never logs payload contents.
 */
export function parseHomeQrInviteV2Payload(
  payload: string,
  options: Readonly<{ nowMs: number }>,
): HomeQrInviteV2 | null {
  if (payload.length > Math.ceil(HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES / 3) * 4) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const bytes = decodeBase64(payload, 'base64url');
  if (bytes.length === 0 || bytes.byteLength > HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    return null;
  }
  const parsed = HomeQrInviteV2Schema.safeParse(value);
  if (!parsed.success) return null;
  // Alternate encodings of a schema-valid invite (different key order,
  // duplicate keys, whitespace) are not the canonical payload form.
  if (encodeHomeQrInviteV2Payload(parsed.data) !== payload) return null;

  const { nowMs } = options;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  if (parsed.data.issuedAtMs > nowMs + HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS) return null;
  if (nowMs > parsed.data.expiresAtMs) return null;
  return parsed.data;
}
