import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '../crypto/base64.js';
import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import { verifyEd25519Signature } from '../crypto/ed25519.js';
import { decodeCanonicalBase64UrlFixedLength } from '../machines/peer/mediation/strictBase64Url.js';
import {
  RUNNER_MACHINE_CONTENT_KEY_FINGERPRINT_PREFIX,
  RunnerMachineContentKeyBindingPayloadV1Schema,
  RunnerMachineContentKeyBindingV1Schema,
  type RunnerMachineContentKeyBindingPayloadV1,
  type RunnerMachineContentKeyBindingV1,
} from './machineContentKeyBindingSchema.js';

export {
  RUNNER_MACHINE_CONTENT_KEY_FINGERPRINT_PREFIX,
  RunnerMachineContentKeyBindingPayloadV1Schema,
  RunnerMachineContentKeyBindingV1Schema,
  type RunnerMachineContentKeyBindingPayloadV1,
  type RunnerMachineContentKeyBindingV1,
};

export function computeRunnerMachineContentKeyFingerprintV1(key: Uint8Array): string {
  if (key.length !== 32) throw new Error('Runner Machine content key must contain exactly 32 bytes');
  return `${RUNNER_MACHINE_CONTENT_KEY_FINGERPRINT_PREFIX}${bytesToHex(sha256(key))}`;
}

/**
 * Signs the binding with the creator-generated activation signing identity.
 *
 * The creator device generates that identity at package creation and retains
 * its private key device-locally through proof publication, so the proof needs
 * no Account signing private key: a DataKey or token-only creator credential
 * produces exactly the same binding. Callers pass the secret key alone; the
 * public half is derived here so a caller can never present a signature under
 * one identity while naming another.
 */
export function signRunnerMachineContentKeyBindingV1(params: Readonly<{
  payload: RunnerMachineContentKeyBindingPayloadV1;
  activationSigningSecretKey: Uint8Array;
}>): RunnerMachineContentKeyBindingV1 {
  const payload = RunnerMachineContentKeyBindingPayloadV1Schema.parse(params.payload);
  if (params.activationSigningSecretKey.length !== tweetnacl.sign.secretKeyLength) {
    throw new Error('Invalid activation signing key');
  }
  const bytes = new TextEncoder().encode(createCanonicalJsonSigningInput(payload));
  return {
    ...payload,
    accountSignatureBase64Url: encodeBase64(
      tweetnacl.sign.detached(bytes, params.activationSigningSecretKey),
      'base64url',
    ),
  };
}

/**
 * Verifies the binding against an independently trusted signing identity.
 *
 * `expectedAccountSigningPublicKey` is the creator's activation signing public
 * key. It must come from the verifier's own trusted scope — the Runner's local
 * activation package, the Home's persisted activation row, or the creator's
 * device-local activation custody — and never from the Home-published Machine
 * row, so substituting verifier key, binding and an Account-openable envelope
 * together still fails.
 */
export function verifyRunnerMachineContentKeyBindingV1(params: Readonly<{
  binding: unknown;
  expectedPayload: unknown;
  /** Trusted creator activation signing public key; not a Home-published field. */
  expectedAccountSigningPublicKey: string;
}>): RunnerMachineContentKeyBindingV1 | null {
  const binding = RunnerMachineContentKeyBindingV1Schema.safeParse(params.binding);
  const expected = RunnerMachineContentKeyBindingPayloadV1Schema.safeParse(params.expectedPayload);
  if (!binding.success || !expected.success) return null;
  const { accountSignatureBase64Url, ...payload } = binding.data;
  if (createCanonicalJsonSigningInput(payload) !== createCanonicalJsonSigningInput(expected.data)) return null;
  const publicKey = decodeCanonicalBase64UrlFixedLength(params.expectedAccountSigningPublicKey, 32);
  const signature = decodeCanonicalBase64UrlFixedLength(accountSignatureBase64Url, 64);
  if (!publicKey || !signature) return null;
  return verifyEd25519Signature(
    new TextEncoder().encode(createCanonicalJsonSigningInput(payload)), signature, publicKey,
  ) ? binding.data : null;
}
