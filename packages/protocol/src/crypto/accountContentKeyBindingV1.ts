import { ed25519 } from '@noble/curves/ed25519';

import {
  ACCOUNT_CONTENT_KEY_BINDING_SIGNATURE_BYTES_V1,
  ACCOUNT_SIGNING_PUBLIC_KEY_BYTES_V1,
  ACCOUNT_SIGNING_SECRET_KEY_BYTES_V1,
} from './accountContentKeyBindingFormatV1.js';
import { isValidBoxBundlePublicKey } from './boxPublicKeyValidation.js';
import { verifyEd25519Signature } from './ed25519.js';
import {
  computeContentPublicKeyFingerprint,
  type ContentPublicKeyFingerprint,
} from '../machines/identity/contentPublicKeyFingerprint.js';

/**
 * Released binding label. The signed bytes are the UTF-8 label, one NUL
 * terminator, then the raw content public key. These bytes are part of the
 * shipped Account content-key binding contract and must never change.
 */
const CONTENT_KEY_BINDING_LABEL = 'Happy content key v1';
const CONTENT_KEY_BINDING_TERMINATOR = 0;

export type VerifiedAccountContentKeyBindingV1 = Readonly<{
  contentPublicKey: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
  contentPublicKeyFingerprint: ContentPublicKeyFingerprint;
}>;

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/**
 * Private on purpose: every producer and verifier of the Account content-key
 * binding must reach these bytes through this module so no caller can
 * reproduce the serialization differently.
 */
function buildAccountContentKeyBindingMessage(contentPublicKey: Uint8Array): Uint8Array {
  const label = new TextEncoder().encode(CONTENT_KEY_BINDING_LABEL);
  const message = new Uint8Array(label.length + 1 + contentPublicKey.length);
  message.set(label, 0);
  message[label.length] = CONTENT_KEY_BINDING_TERMINATOR;
  message.set(contentPublicKey, label.length + 1);
  return message;
}

/**
 * Signs the Account content-key binding with the Account signing key.
 * Malformed local key material is a caller defect, not adversarial input, so
 * it throws instead of returning an unusable binding.
 */
export function signAccountContentKeyBindingV1(params: Readonly<{
  accountSigningSecretKey: Uint8Array;
  contentPublicKey: Uint8Array;
}>): Uint8Array<ArrayBuffer> {
  if (params.accountSigningSecretKey.byteLength !== ACCOUNT_SIGNING_SECRET_KEY_BYTES_V1) {
    throw new Error(
      `Invalid Account signing secret key length: expected ${ACCOUNT_SIGNING_SECRET_KEY_BYTES_V1} bytes`,
    );
  }
  if (!isValidBoxBundlePublicKey(params.contentPublicKey)) {
    throw new Error('Invalid content public key: malformed or low-order X25519 public keys are rejected');
  }
  return copyBytes(ed25519.sign(
    buildAccountContentKeyBindingMessage(params.contentPublicKey),
    params.accountSigningSecretKey.subarray(0, ACCOUNT_SIGNING_SECRET_KEY_BYTES_V1 / 2),
  ));
}

/**
 * Verifies that the supplied Account signing key bound this content public
 * key. Returns validated copies plus the canonical content-key fingerprint,
 * or `null` for any malformed or unverified input.
 *
 * A verified signature establishes the relationship to the supplied signing
 * key only; it does not authenticate that signing key against a Home that can
 * substitute the whole binding on an unpinned lookup.
 */
export function verifyAccountContentKeyBindingV1(params: Readonly<{
  accountSigningPublicKey: Uint8Array;
  contentPublicKey: Uint8Array;
  signature: Uint8Array;
}>): VerifiedAccountContentKeyBindingV1 | null {
  if (
    params.accountSigningPublicKey.byteLength !== ACCOUNT_SIGNING_PUBLIC_KEY_BYTES_V1
    || !isValidBoxBundlePublicKey(params.contentPublicKey)
    || params.signature.byteLength !== ACCOUNT_CONTENT_KEY_BINDING_SIGNATURE_BYTES_V1
  ) {
    return null;
  }

  const contentPublicKey = copyBytes(params.contentPublicKey);
  const signature = copyBytes(params.signature);
  try {
    if (!verifyEd25519Signature(
      buildAccountContentKeyBindingMessage(contentPublicKey),
      signature,
      params.accountSigningPublicKey,
    )) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    contentPublicKey,
    signature,
    contentPublicKeyFingerprint: computeContentPublicKeyFingerprint(contentPublicKey),
  };
}
