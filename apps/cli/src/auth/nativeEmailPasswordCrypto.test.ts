import { describe, expect, it } from 'vitest';

import {
  decodePasswordCredentialFieldV1,
  encodePasswordCredentialFieldV1,
  verifyAccountContentKeyBindingV1,
} from '@happier-dev/protocol';

import {
  deriveNativeEmailPasswordKeys,
  openNativeEmailPasswordEnvelope,
  prepareNativeEmailPasswordCredential,
} from './nativeEmailPasswordCrypto';

describe('native email password crypto', () => {
  it('matches the cross-client Argon2id/HKDF golden vector', async () => {
    const keys = await deriveNativeEmailPasswordKeys({
      password: 'a password with spaces 🗝',
      kdf: {
        algorithm: 'argon2id13',
        salt: 'AAAAAAAAAAAAAAAAAAAAAA',
        opsLimit: 3,
        memLimitBytes: 64 * 1024 * 1024,
        outputBytes: 32,
      },
    });
    try {
      expect(encodePasswordCredentialFieldV1(keys.authKey)).toBe(
        '7VQv5bMjwJVCy2xKgDSf4iZBHCsrd3O2eJY12_UWhZE',
      );
    } finally {
      keys.authKey.fill(0);
      keys.wrapKey.fill(0);
    }
  });

  it('writes an envelope and content-key proof accepted by the canonical readers', async () => {
    const secret = new Uint8Array(32).fill(17);
    const prepared = await prepareNativeEmailPasswordCredential({ password: 'a sufficiently long password', secret });
    const keys = await deriveNativeEmailPasswordKeys({
      password: 'a sufficiently long password',
      kdf: prepared.envelope.kdf,
    });
    let opened: Uint8Array | undefined;
    try {
      opened = openNativeEmailPasswordEnvelope(prepared.envelope, keys.wrapKey);
      expect(opened).toEqual(secret);
      expect(verifyAccountContentKeyBindingV1({
        accountSigningPublicKey: decodePasswordCredentialFieldV1(prepared.envelope.accountSigningPublicKey),
        contentPublicKey: decodePasswordCredentialFieldV1(prepared.contentPublicKey),
        signature: decodePasswordCredentialFieldV1(prepared.contentPublicKeySig),
      })).not.toBeNull();
    } finally {
      keys.authKey.fill(0);
      keys.wrapKey.fill(0);
      opened?.fill(0);
      secret.fill(0);
    }
  });
});
