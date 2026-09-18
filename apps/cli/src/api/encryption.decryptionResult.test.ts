import { createCipheriv } from 'node:crypto';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';

import { decrypt, decryptLegacy, decryptLegacyResult, decryptWithDataKey, decryptWithDataKeyResult, encryptLegacy, encryptWithDataKey } from './encryption';

describe('data-key authenticated content result', () => {
  const key = new Uint8Array(32).fill(17);

  it.each([null, undefined, { text: 'source content' }])('preserves authenticated value %j independently of presentation shape', (value) => {
    const ciphertext = encryptWithDataKey(value, key);
    expect(decryptWithDataKeyResult(ciphertext, key)).toEqual({ status: 'authenticated', value });
    expect(decryptWithDataKey(ciphertext, key)).toEqual(value);
  });

  it('distinguishes a wrong key and tampered authentication tag from authenticated null', () => {
    const ciphertext = encryptWithDataKey(null, key);
    expect(decryptWithDataKeyResult(ciphertext, new Uint8Array(32).fill(18)))
      .toEqual({ status: 'authentication_failed' });
    const tampered = ciphertext.slice();
    tampered[tampered.length - 1] ^= 1;
    expect(decryptWithDataKeyResult(tampered, key)).toEqual({ status: 'authentication_failed' });
    expect(decryptWithDataKey(tampered, key)).toBeNull();
  });

  it('does not claim authentication failure for an unsupported or incomplete bundle', () => {
    const unsupported = encryptWithDataKey({ text: 'source content' }, key);
    unsupported[0] = 99;
    for (const bundle of [unsupported, new Uint8Array(), new Uint8Array(28)]) {
      expect(decryptWithDataKeyResult(bundle, key)).toEqual({ status: 'unsupported' });
      expect(decryptWithDataKey(bundle, key)).toBeNull();
    }
  });

  it('separates authenticated invalid serialization from AES authentication failure', () => {
    // Independent OS crypto boundary produces authenticated bytes that the JSON
    // writer cannot emit. No internal parser or cipher is mocked.
    const nonce = new Uint8Array(12).fill(21);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update('not JSON', 'utf8'), cipher.final()]);
    const bundle = Buffer.concat([Buffer.from([0]), nonce, ciphertext, cipher.getAuthTag()]);
    expect(decryptWithDataKeyResult(bundle, key)).toEqual({ status: 'invalid_payload' });
    expect(decryptWithDataKey(bundle, key)).toBeNull();
  });
});

describe('legacy authenticated content result', () => {
  const key = new Uint8Array(32).fill(31);

  it.each([null, undefined, { text: 'historical content' }])('preserves authenticated value %j', (value) => {
    const ciphertext = encryptLegacy(value, key);
    expect(decryptLegacyResult(ciphertext, key)).toEqual({ status: 'authenticated', value });
    expect(decryptLegacy(ciphertext, key)).toEqual(value);
    expect(decrypt(key, 'legacy', ciphertext)).toEqual(value);
  });

  it('distinguishes failed authentication from an incomplete bundle', () => {
    const ciphertext = encryptLegacy(null, key);
    expect(decryptLegacyResult(ciphertext, new Uint8Array(32).fill(32)))
      .toEqual({ status: 'authentication_failed' });
    expect(decryptLegacyResult(new Uint8Array(39), key)).toEqual({ status: 'unsupported' });
    expect(decryptLegacy(new Uint8Array(39), key)).toBeNull();
  });

  it('distinguishes authenticated invalid serialization without throwing from nullable wrappers', () => {
    const nonce = new Uint8Array(24).fill(33);
    const ciphertext = nacl.secretbox(new TextEncoder().encode('not JSON'), nonce, key);
    const bundle = new Uint8Array([...nonce, ...ciphertext]);
    expect(decryptLegacyResult(bundle, key)).toEqual({ status: 'invalid_payload' });
    expect(decryptLegacy(bundle, key)).toBeNull();
    expect(decrypt(key, 'legacy', bundle)).toBeNull();
  });
});
