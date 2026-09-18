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

export function signRunnerMachineContentKeyBindingV1(params: Readonly<{
  payload: RunnerMachineContentKeyBindingPayloadV1;
  accountSigningPublicKey: Uint8Array;
  accountSigningSecretKey: Uint8Array;
}>): RunnerMachineContentKeyBindingV1 {
  const payload = RunnerMachineContentKeyBindingPayloadV1Schema.parse(params.payload);
  if (params.accountSigningPublicKey.length !== 32 || params.accountSigningSecretKey.length !== 64) {
    throw new Error('Invalid Account signing key');
  }
  if (!tweetnacl.verify(
    tweetnacl.sign.keyPair.fromSecretKey(params.accountSigningSecretKey).publicKey,
    params.accountSigningPublicKey,
  )) throw new Error('Account signing public and secret keys do not match');
  const bytes = new TextEncoder().encode(createCanonicalJsonSigningInput(payload));
  return {
    ...payload,
    accountSignatureBase64Url: encodeBase64(tweetnacl.sign.detached(bytes, params.accountSigningSecretKey), 'base64url'),
  };
}

export function verifyRunnerMachineContentKeyBindingV1(params: Readonly<{
  binding: unknown;
  expectedPayload: unknown;
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
