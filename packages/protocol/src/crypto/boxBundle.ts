import tweetnacl from 'tweetnacl';
import { sha512 } from '@noble/hashes/sha512';

export const BOX_BUNDLE_PUBLIC_KEY_BYTES = tweetnacl.box.publicKeyLength; // 32
export const BOX_BUNDLE_NONCE_BYTES = tweetnacl.box.nonceLength; // 24
export const BOX_BUNDLE_MIN_BYTES = BOX_BUNDLE_PUBLIC_KEY_BYTES + BOX_BUNDLE_NONCE_BYTES + 16;

export function deriveBoxSecretKeyFromSeed(seed: Uint8Array): Uint8Array {
  // libsodium crypto_box_seed_keypair uses SHA-512(seed) and takes the first 32 bytes as the scalar.
  return sha512(seed).slice(0, 32);
}

export function deriveBoxPublicKeyFromSeed(seed: Uint8Array): Uint8Array {
  const secretKey = deriveBoxSecretKeyFromSeed(seed);
  return tweetnacl.box.keyPair.fromSecretKey(secretKey).publicKey;
}

/**
 * Fixed nonzero X25519 scalar used only as a low-order probe. tweetnacl
 * clamps scalars, and a clamped scalar is always a multiple of 8, so it
 * annihilates every point of the curve's order-8 torsion subgroup: probing a
 * low-order public key (including the all-zero key) yields the all-zero
 * result, while a valid high-order public key never does.
 */
const BOX_BUNDLE_LOW_ORDER_PROBE_SECRET_SCALAR = deriveBoxSecretKeyFromSeed(
  new TextEncoder().encode('happier.boxBundle.low-order-probe.v1'),
);

/**
 * Validates an X25519 public key for use as a box-bundle key: exact 32-byte
 * length and not a low-order point. Low-order keys let unrelated private
 * scalars derive the same shared secret, defeating unique key binding, so
 * they are rejected on the cryptographic property rather than a blacklist.
 */
export function isValidBoxBundlePublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== BOX_BUNDLE_PUBLIC_KEY_BYTES) return false;
  try {
    const probe = tweetnacl.scalarMult(BOX_BUNDLE_LOW_ORDER_PROBE_SECRET_SCALAR, publicKey);
    return probe.some((byte) => byte !== 0);
  } catch {
    return false;
  }
}

export function sealBoxBundle(params: {
  plaintext: Uint8Array;
  recipientPublicKey: Uint8Array;
  randomBytes: (length: number) => Uint8Array;
}): Uint8Array {
  if (params.recipientPublicKey.length !== BOX_BUNDLE_PUBLIC_KEY_BYTES) {
    throw new Error(`Invalid recipient public key length: ${params.recipientPublicKey.length}`);
  }
  if (!isValidBoxBundlePublicKey(params.recipientPublicKey)) {
    throw new Error('Invalid recipient public key: low-order X25519 public keys are rejected');
  }

  const ephSecretKey = params.randomBytes(tweetnacl.box.secretKeyLength);
  if (ephSecretKey.length !== tweetnacl.box.secretKeyLength) {
    throw new Error(`Invalid ephemeral secret key length: ${ephSecretKey.length}`);
  }
  const ephKeyPair = tweetnacl.box.keyPair.fromSecretKey(ephSecretKey);

  const nonce = params.randomBytes(tweetnacl.box.nonceLength);
  if (nonce.length !== tweetnacl.box.nonceLength) {
    throw new Error(`Invalid nonce length: ${nonce.length}`);
  }

  const boxed = tweetnacl.box(params.plaintext, nonce, params.recipientPublicKey, ephSecretKey);

  const out = new Uint8Array(ephKeyPair.publicKey.length + nonce.length + boxed.length);
  out.set(ephKeyPair.publicKey, 0);
  out.set(nonce, ephKeyPair.publicKey.length);
  out.set(boxed, ephKeyPair.publicKey.length + nonce.length);
  return out;
}

export function openBoxBundle(params: {
  bundle: Uint8Array;
  recipientSecretKeyOrSeed: Uint8Array;
}): Uint8Array | null {
  const bundle = params.bundle;
  if (bundle.length < BOX_BUNDLE_MIN_BYTES) {
    return null;
  }
  if (params.recipientSecretKeyOrSeed.length !== tweetnacl.box.secretKeyLength) {
    return null;
  }

  const ephemeralPublicKey = bundle.slice(0, BOX_BUNDLE_PUBLIC_KEY_BYTES);
  const nonce = bundle.slice(BOX_BUNDLE_PUBLIC_KEY_BYTES, BOX_BUNDLE_PUBLIC_KEY_BYTES + BOX_BUNDLE_NONCE_BYTES);
  const boxed = bundle.slice(BOX_BUNDLE_PUBLIC_KEY_BYTES + BOX_BUNDLE_NONCE_BYTES);

  // A low-order embedded ephemeral key forces a publicly computable shared
  // secret; reject before any plaintext could be produced.
  if (!isValidBoxBundlePublicKey(ephemeralPublicKey)) return null;

  const tryOpen = (secretKey: Uint8Array): Uint8Array | null => {
    try {
      const opened = tweetnacl.box.open(boxed, nonce, ephemeralPublicKey, secretKey);
      return opened ? new Uint8Array(opened) : null;
    } catch {
      return null;
    }
  };

  const direct = tryOpen(params.recipientSecretKeyOrSeed);
  if (direct) return direct;

  const compatSecretKey = deriveBoxSecretKeyFromSeed(params.recipientSecretKeyOrSeed);
  return tryOpen(compatSecretKey);
}
