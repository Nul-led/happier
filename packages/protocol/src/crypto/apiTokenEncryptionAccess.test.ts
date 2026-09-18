import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { AccountApiTokenEncryptionAccessV1Schema } from '../auth/accountApiTokens.js';
import { deriveAccountMachineKeyFromRecoverySecret, openAccountScopedBlobCiphertext, sealAccountScopedBlobCiphertext } from './accountScopedCipher.js';
import { decodeBase64, encodeBase64 } from './base64.js';
import { deriveKey } from './keyDerivation.js';
import { openApiTokenEncryptionAccessV1, wrapApiTokenEncryptionAccessV1 } from './apiTokenEncryptionAccess.js';

const contentPrivateKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const wrappingSecret = Uint8Array.from({ length: 32 }, (_, i) => i + 101);
const nonce = Uint8Array.from({ length: 24 }, (_, i) => i + 41);
const context = {
  serverIdentityId: 'srv_crypto-vector',
  accountId: 'account-vector',
  tokenId: '00000000-0000-4000-8000-000000000001',
  contentPublicKey: 'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=',
};

// Independently generated with Python stdlib HMAC-SHA512 and libsodium.so.23
// crypto_scalarmult_base/crypto_secretbox_easy, using the byte sequences above
// and the published V1 KDF path. Neither production KDF nor wrap/open generated it.
const vector = {
  v: 1 as const,
  serverIdentityId: context.serverIdentityId,
  contentPublicKey: context.contentPublicKey,
  wrappedContentPrivateKey: 'KSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9A1RKwqe1MU9rod7dj5g_OBuR0vrY8KsWEQ0C3KFxOcUce5elqgGQotnj_y0OOaG4u',
};

describe('API token content-key wrapping V1', () => {
  it('opens the independent fixed-format content-key vector', () => {
    expect(openApiTokenEncryptionAccessV1({ context, wrappingSecret, encryptionAccess: vector }))
      .toEqual(contentPrivateKey);
  });

  it('writes the independent fixed-format vector', () => {
    const record = wrapApiTokenEncryptionAccessV1({ context, wrappingSecret, contentPrivateKey, randomBytes: () => nonce });
    expect(record).toEqual(vector);
    expect(AccountApiTokenEncryptionAccessV1Schema.safeParse(record).success).toBe(true);
    expect(decodeBase64(record.wrappedContentPrivateKey, 'base64url')).toHaveLength(72);
  });

  it.each([
    { serverIdentityId: 'srv_other' },
    { accountId: 'another-account' },
    { tokenId: '00000000-0000-4000-8000-000000000002' },
    { contentPublicKey: encodeBase64(tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(7)).publicKey) },
  ])('rejects a changed local pin: %j', (changed) => {
    expect(openApiTokenEncryptionAccessV1({ context: { ...context, ...changed }, wrappingSecret, encryptionAccess: vector })).toBeNull();
  });

  it('rejects nonce and authenticated ciphertext tampering and a different wrapping secret', () => {
    for (const index of [0, 24, 71]) {
      const bytes = decodeBase64(vector.wrappedContentPrivateKey, 'base64url');
      bytes[index] ^= 1;
      expect(openApiTokenEncryptionAccessV1({ context, wrappingSecret, encryptionAccess: {
        ...vector, wrappedContentPrivateKey: encodeBase64(bytes, 'base64url'),
      } })).toBeNull();
    }
    expect(openApiTokenEncryptionAccessV1({ context, wrappingSecret: new Uint8Array(32).fill(7), encryptionAccess: vector })).toBeNull();
  });

  it('rejects an authenticated private key that does not match the advertised binding', () => {
    const key = deriveKey(wrappingSecret, 'Happier API token content wrap', [
      'v1', context.serverIdentityId, context.accountId, context.tokenId, context.contentPublicKey,
    ]);
    const unrelatedPrivateKey = new Uint8Array(32).fill(7);
    const boxed = tweetnacl.secretbox(unrelatedPrivateKey, nonce, key);
    expect(tweetnacl.secretbox.open(boxed, nonce, key)).toEqual(unrelatedPrivateKey);
    const bytes = new Uint8Array([...nonce, ...boxed]);
    const record = { ...vector, wrappedContentPrivateKey: encodeBase64(bytes, 'base64url') };
    expect(AccountApiTokenEncryptionAccessV1Schema.safeParse(record).success).toBe(true);
    expect(openApiTokenEncryptionAccessV1({ context, wrappingSecret, encryptionAccess: record })).toBeNull();
    expect(() => wrapApiTokenEncryptionAccessV1({ context, wrappingSecret, contentPrivateKey: unrelatedPrivateKey, randomBytes: () => nonce })).toThrow();
  });

  it.each([
    null,
    { ...vector, v: 2 },
    { ...vector, unexpected: true },
    { ...vector, serverIdentityId: 'srv_other' },
    { ...vector, contentPublicKey: `${context.contentPublicKey}\n` },
    { ...vector, contentPublicKey: context.contentPublicKey.slice(0, -1) },
    { ...vector, contentPublicKey: encodeBase64(new Uint8Array(31)) },
    { ...vector, wrappedContentPrivateKey: `${vector.wrappedContentPrivateKey}=` },
    { ...vector, wrappedContentPrivateKey: ` ${vector.wrappedContentPrivateKey}` },
    { ...vector, wrappedContentPrivateKey: vector.wrappedContentPrivateKey.replace(/_/g, '/') },
    { ...vector, wrappedContentPrivateKey: encodeBase64(new Uint8Array(71), 'base64url') },
    { ...vector, wrappedContentPrivateKey: encodeBase64(new Uint8Array(73), 'base64url') },
  ])('fails closed for malformed or mismatched record %#', (encryptionAccess) => {
    expect(openApiTokenEncryptionAccessV1({ context, wrappingSecret, encryptionAccess })).toBeNull();
  });

  it.each([0, 31, 33])('rejects %i-byte wrapping secrets and content private keys', (length) => {
    const wrongLength = new Uint8Array(length);
    expect(openApiTokenEncryptionAccessV1({ context, wrappingSecret: wrongLength, encryptionAccess: vector })).toBeNull();
    expect(() => wrapApiTokenEncryptionAccessV1({ context, wrappingSecret: wrongLength, contentPrivateKey, randomBytes: () => nonce })).toThrow();
    expect(() => wrapApiTokenEncryptionAccessV1({ context, wrappingSecret, contentPrivateKey: wrongLength, randomBytes: () => nonce })).toThrow();
  });

  it.each([0, 23, 25])('rejects a %i-byte randomness callback nonce', (length) => {
    expect(() => wrapApiTokenEncryptionAccessV1({ context, wrappingSecret, contentPrivateKey, randomBytes: () => new Uint8Array(length) })).toThrow();
  });

  it.each([
    { serverIdentityId: 'https://home.example' },
    { accountId: '' },
    { tokenId: 'not-a-token-id' },
    { contentPublicKey: context.contentPublicKey.slice(0, -1) },
    { contentPublicKey: encodeBase64(new Uint8Array(33)) },
  ])('rejects invalid local context on wrapping and opening: %j', (changed) => {
    const invalidContext = { ...context, ...changed };
    expect(() => wrapApiTokenEncryptionAccessV1({ context: invalidContext, wrappingSecret, contentPrivateKey, randomBytes: () => nonce })).toThrow();
    expect(openApiTokenEncryptionAccessV1({ context: invalidContext, wrappingSecret, encryptionAccess: vector })).toBeNull();
  });

  it('two token-bound wrappers independently deliver the same legacy-derived Account content key', () => {
    const recoverySecret = new Uint8Array(32).fill(9);
    const machineKey = deriveAccountMachineKeyFromRecoverySecret(recoverySecret);
    const common = { ...context, contentPublicKey: encodeBase64(tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey) };
    const secondContext = { ...common, tokenId: '00000000-0000-4000-8000-000000000002' };
    const secondSecret = new Uint8Array(32).fill(77);
    const first = wrapApiTokenEncryptionAccessV1({ context: common, wrappingSecret, contentPrivateKey: machineKey, randomBytes: () => nonce });
    const second = wrapApiTokenEncryptionAccessV1({ context: secondContext, wrappingSecret: secondSecret, contentPrivateKey: new Uint8Array(machineKey), randomBytes: () => new Uint8Array(24).fill(8) });
    expect(first.wrappedContentPrivateKey).not.toBe(second.wrappedContentPrivateKey);
    expect(openApiTokenEncryptionAccessV1({ context: common, wrappingSecret, encryptionAccess: second })).toBeNull();
    expect(openApiTokenEncryptionAccessV1({ context: secondContext, wrappingSecret: secondSecret, encryptionAccess: first })).toBeNull();
    const ciphertext = sealAccountScopedBlobCiphertext({
      kind: 'external_action_transport', material: { type: 'legacy', secret: recoverySecret },
      payload: { direction: 'request', input: { message: 'Account-wide content' } }, randomBytes: () => nonce,
    });
    for (const params of [
      { context: common, wrappingSecret, encryptionAccess: first },
      { context: secondContext, wrappingSecret: secondSecret, encryptionAccess: second },
    ]) {
      const opened = openApiTokenEncryptionAccessV1(params);
      expect(opened).toEqual(machineKey);
      expect(opened).not.toEqual(recoverySecret);
      expect(opened).toHaveLength(32);
      if (!opened) throw new Error('Expected content material');
      expect(openAccountScopedBlobCiphertext({ kind: 'external_action_transport', material: { type: 'dataKey', machineKey: opened }, ciphertext }))
        .toMatchObject({ value: { direction: 'request', input: { message: 'Account-wide content' } } });
    }
  });
});
