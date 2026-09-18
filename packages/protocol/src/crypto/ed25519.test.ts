import tweetnacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';

import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  signEd25519Message,
} from './ed25519.js';

describe('Ed25519 crypto compatibility', () => {
  it('signs the released 64-byte NaCl secret-key representation interoperably', () => {
    const keyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const message = new TextEncoder().encode('happier-ed25519-compatibility');

    expect(ED25519_PUBLIC_KEY_BYTES).toBe(tweetnacl.sign.publicKeyLength);
    expect(ED25519_SECRET_KEY_BYTES).toBe(tweetnacl.sign.secretKeyLength);
    expect(ED25519_SIGNATURE_BYTES).toBe(tweetnacl.sign.signatureLength);
    expect(signEd25519Message(message, keyPair.secretKey))
      .toEqual(tweetnacl.sign.detached(message, keyPair.secretKey));
  });

  it('rejects secret keys outside the released 64-byte representation', () => {
    expect(() => signEd25519Message(new Uint8Array(), new Uint8Array(32)))
      .toThrow('expected 64 bytes');
  });
});
