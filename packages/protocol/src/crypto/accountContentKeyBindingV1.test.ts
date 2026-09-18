import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
  signAccountContentKeyBindingV1,
  verifyAccountContentKeyBindingV1,
} from './accountContentKeyBindingV1.js';
import {
  ACCOUNT_CONTENT_KEY_BINDING_SIGNATURE_BYTES_V1,
  ACCOUNT_CONTENT_PUBLIC_KEY_BYTES_V1,
  ACCOUNT_SIGNING_PUBLIC_KEY_BYTES_V1,
  ACCOUNT_SIGNING_SECRET_KEY_BYTES_V1,
} from './accountContentKeyBindingFormatV1.js';
import {
  ContentPublicKeyFingerprintSchema,
  computeContentPublicKeyFingerprint,
} from '../machines/identity/installationIdentity.js';

/**
 * Independent vector. The signed bytes are rebuilt here from an explicit
 * `Happy content key v1\0` byte sequence and tweetnacl, so the shared signer
 * and verifier cannot drift together away from the released binding format.
 */
const RELEASED_BINDING_PREFIX_BYTES = Uint8Array.from([
  72, 97, 112, 112, 121, 32, 99, 111, 110, 116, 101, 110, 116, 32,
  107, 101, 121, 32, 118, 49, 0,
]);

const VECTOR = {
  signingSeedHex: '2121212121212121212121212121212121212121212121212121212121212121',
  signingPublicKeyHex: '884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b',
  contentSecretKeyHex: '2222222222222222222222222222222222222222222222222222222222222222',
  contentPublicKeyHex: '0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20',
  signatureHex:
    '3e4a87c0bef059f7ea869a7d0c7b85b539a4dd5378003690ed977ac8e0d228222aee75b0'
    + '63ed86215c8b1be111fcac216b9e701927ca8efd6a5d3df30c46f10a',
  fingerprint:
    'content-public-key-sha256:65cf5c9b1de5d41f758cb67f2d05f3e316a203fcb56351d9e3f158e02962c74d',
} as const;

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function buildIndependentBindingMessage(contentPublicKey: Uint8Array): Uint8Array {
  const message = new Uint8Array(
    RELEASED_BINDING_PREFIX_BYTES.length + contentPublicKey.length,
  );
  message.set(RELEASED_BINDING_PREFIX_BYTES, 0);
  message.set(contentPublicKey, RELEASED_BINDING_PREFIX_BYTES.length);
  return message;
}

function vectorSigningSecretKey(): Uint8Array {
  return tweetnacl.sign.keyPair.fromSeed(fromHex(VECTOR.signingSeedHex)).secretKey;
}

describe('accountContentKeyBindingFormatV1', () => {
  // Wire schemas admit a transported binding from these literals instead of
  // loading the signer, so a drifted literal would admit or reject material the
  // verifier disagrees with. Pin each one to the primitive it describes.
  it('pins the binding field lengths to the primitives they describe', () => {
    expect(ACCOUNT_SIGNING_PUBLIC_KEY_BYTES_V1).toBe(tweetnacl.sign.publicKeyLength);
    expect(ACCOUNT_SIGNING_SECRET_KEY_BYTES_V1).toBe(tweetnacl.sign.secretKeyLength);
    expect(ACCOUNT_CONTENT_KEY_BINDING_SIGNATURE_BYTES_V1).toBe(tweetnacl.sign.signatureLength);
    expect(ACCOUNT_CONTENT_PUBLIC_KEY_BYTES_V1).toBe(tweetnacl.box.publicKeyLength);
  });
});

describe('signAccountContentKeyBindingV1', () => {
  it('rejects a content-key binding forged with an Ed25519 identity-point Account key', () => {
    const identityPoint = new Uint8Array(32);
    identityPoint[0] = 1;
    const forgedSignature = new Uint8Array(64);
    forgedSignature[0] = 1;
    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: identityPoint,
      contentPublicKey: fromHex(VECTOR.contentPublicKeyHex),
      signature: forgedSignature,
    })).toBeNull();
  });

  it('reproduces the released binding signature for the independent vector', () => {
    const signature = signAccountContentKeyBindingV1({
      accountSigningSecretKey: vectorSigningSecretKey(),
      contentPublicKey: fromHex(VECTOR.contentPublicKeyHex),
    });

    expect(toHex(signature)).toBe(VECTOR.signatureHex);
  });

  it('signs exactly the released prefix followed by the content public key', () => {
    const contentPublicKey = tweetnacl.box.keyPair.fromSecretKey(
      new Uint8Array(32).fill(7),
    ).publicKey;
    const signingKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(3));

    const signature = signAccountContentKeyBindingV1({
      accountSigningSecretKey: signingKeyPair.secretKey,
      contentPublicKey,
    });

    expect(tweetnacl.sign.detached.verify(
      buildIndependentBindingMessage(contentPublicKey),
      signature,
      signingKeyPair.publicKey,
    )).toBe(true);
    // A bare content public key without the domain prefix must not verify.
    expect(tweetnacl.sign.detached.verify(
      contentPublicKey,
      signature,
      signingKeyPair.publicKey,
    )).toBe(false);
  });

  it('rejects a signing secret key of the wrong length', () => {
    expect(() => signAccountContentKeyBindingV1({
      accountSigningSecretKey: new Uint8Array(32).fill(1),
      contentPublicKey: fromHex(VECTOR.contentPublicKeyHex),
    })).toThrow();
  });

  it('rejects a low-order content public key', () => {
    expect(() => signAccountContentKeyBindingV1({
      accountSigningSecretKey: vectorSigningSecretKey(),
      contentPublicKey: new Uint8Array(32),
    })).toThrow();
  });
});

describe('verifyAccountContentKeyBindingV1', () => {
  it('accepts the independent vector and returns its canonical fingerprint', () => {
    const contentPublicKey = fromHex(VECTOR.contentPublicKeyHex);
    const verified = verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: fromHex(VECTOR.signingPublicKeyHex),
      contentPublicKey,
      signature: fromHex(VECTOR.signatureHex),
    });

    expect(verified).not.toBeNull();
    expect(toHex(verified!.contentPublicKey)).toBe(VECTOR.contentPublicKeyHex);
    expect(toHex(verified!.signature)).toBe(VECTOR.signatureHex);
    expect(verified!.contentPublicKeyFingerprint).toBe(VECTOR.fingerprint);
    expect(verified!.contentPublicKeyFingerprint).toBe(
      computeContentPublicKeyFingerprint(contentPublicKey),
    );
    expect(
      ContentPublicKeyFingerprintSchema.safeParse(verified!.contentPublicKeyFingerprint).success,
    ).toBe(true);
  });

  it('returns copies that later caller mutation cannot change', () => {
    const contentPublicKey = fromHex(VECTOR.contentPublicKeyHex);
    const signature = fromHex(VECTOR.signatureHex);
    const verified = verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: fromHex(VECTOR.signingPublicKeyHex),
      contentPublicKey,
      signature,
    });
    expect(verified).not.toBeNull();

    contentPublicKey.fill(0);
    signature.fill(0);

    expect(toHex(verified!.contentPublicKey)).toBe(VECTOR.contentPublicKeyHex);
    expect(toHex(verified!.signature)).toBe(VECTOR.signatureHex);
  });

  it('verifies a freshly signed binding round trip', () => {
    const signingKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(11));
    const contentPublicKey = tweetnacl.box.keyPair.fromSecretKey(
      new Uint8Array(32).fill(12),
    ).publicKey;
    const signature = signAccountContentKeyBindingV1({
      accountSigningSecretKey: signingKeyPair.secretKey,
      contentPublicKey,
    });

    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: signingKeyPair.publicKey,
      contentPublicKey,
      signature,
    })).not.toBeNull();
  });

  it('rejects a binding signed by a different Account signing key', () => {
    const otherSigningKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));

    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: otherSigningKeyPair.publicKey,
      contentPublicKey: fromHex(VECTOR.contentPublicKeyHex),
      signature: fromHex(VECTOR.signatureHex),
    })).toBeNull();
  });

  it('rejects a substituted content public key under a valid signature', () => {
    const substituted = tweetnacl.box.keyPair.fromSecretKey(
      new Uint8Array(32).fill(13),
    ).publicKey;

    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: fromHex(VECTOR.signingPublicKeyHex),
      contentPublicKey: substituted,
      signature: fromHex(VECTOR.signatureHex),
    })).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const signature = fromHex(VECTOR.signatureHex);
    signature[0] ^= 0xff;

    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: fromHex(VECTOR.signingPublicKeyHex),
      contentPublicKey: fromHex(VECTOR.contentPublicKeyHex),
      signature,
    })).toBeNull();
  });

  it('rejects malformed signing keys, content keys, and signatures', () => {
    const signingPublicKey = fromHex(VECTOR.signingPublicKeyHex);
    const contentPublicKey = fromHex(VECTOR.contentPublicKeyHex);
    const signature = fromHex(VECTOR.signatureHex);

    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: signingPublicKey.slice(0, 31),
      contentPublicKey,
      signature,
    })).toBeNull();
    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: signingPublicKey,
      contentPublicKey: contentPublicKey.slice(0, 31),
      signature,
    })).toBeNull();
    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: signingPublicKey,
      contentPublicKey,
      signature: signature.slice(0, 63),
    })).toBeNull();
    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: signingPublicKey,
      contentPublicKey,
      signature: new Uint8Array(0),
    })).toBeNull();
  });

  it('rejects a low-order X25519 content public key even with a valid signature', () => {
    const lowOrderContentPublicKey = new Uint8Array(32);
    const signingKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(5));
    const signature = tweetnacl.sign.detached(
      buildIndependentBindingMessage(lowOrderContentPublicKey),
      signingKeyPair.secretKey,
    );

    expect(verifyAccountContentKeyBindingV1({
      accountSigningPublicKey: signingKeyPair.publicKey,
      contentPublicKey: lowOrderContentPublicKey,
      signature,
    })).toBeNull();
  });
});
