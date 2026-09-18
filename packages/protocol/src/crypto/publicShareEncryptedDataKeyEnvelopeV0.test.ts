import { describe, expect, it } from 'vitest';

import {
  openPublicShareEncryptedDataKeyEnvelopeV0,
  parsePublicShareEncryptedDataKeyEnvelopeV0,
  PUBLIC_SHARE_ENCRYPTED_DATA_KEY_CURRENT_V0_BYTES,
  PUBLIC_SHARE_ENCRYPTED_DATA_KEY_LEGACY_V0_BYTES,
  sealPublicShareEncryptedDataKeyEnvelopeV0,
} from './publicShareEncryptedDataKeyEnvelopeV0.js';

describe('parsePublicShareEncryptedDataKeyEnvelopeV0', () => {
  it('accepts the deployed legacy/current SecretBox lengths and rejects generic Box', () => {
    expect(parsePublicShareEncryptedDataKeyEnvelopeV0(
      new Uint8Array(PUBLIC_SHARE_ENCRYPTED_DATA_KEY_LEGACY_V0_BYTES),
    )?.format).toBe('legacy-json');
    expect(parsePublicShareEncryptedDataKeyEnvelopeV0(
      new Uint8Array(PUBLIC_SHARE_ENCRYPTED_DATA_KEY_CURRENT_V0_BYTES),
    )?.format).toBe('serialized-json-v1');
    expect(parsePublicShareEncryptedDataKeyEnvelopeV0(new Uint8Array(105))).toBeNull();
  });
});

describe('public-share encrypted data-key V0 format', () => {
  it('owns the current writer framing and opens its authenticated payload', () => {
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const wrappingKey = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(24).fill(3);

    const envelope = sealPublicShareEncryptedDataKeyEnvelopeV0({
      dataKey,
      wrappingKey,
      randomBytes: (length) => {
        expect(length).toBe(nonce.byteLength);
        return nonce;
      },
    });

    expect(envelope).toHaveLength(PUBLIC_SHARE_ENCRYPTED_DATA_KEY_CURRENT_V0_BYTES);
    expect(openPublicShareEncryptedDataKeyEnvelopeV0({ envelope, wrappingKey })).toEqual(dataKey);
  });

  it('keeps the deployed legacy JSON payload readable without making it a current writer', async () => {
    const tweetnacl = (await import('tweetnacl')).default;
    const dataKey = new Uint8Array(32).fill(11);
    const wrappingKey = new Uint8Array(32).fill(17);
    const nonce = new Uint8Array(tweetnacl.secretbox.nonceLength).fill(19);
    const legacyPlaintext = new TextEncoder().encode(JSON.stringify({
      v: 0,
      keyB64: Buffer.from(dataKey).toString('base64'),
    }));
    const boxed = tweetnacl.secretbox(legacyPlaintext, nonce, wrappingKey);
    const envelope = new Uint8Array(nonce.byteLength + boxed.byteLength);
    envelope.set(nonce);
    envelope.set(boxed, nonce.byteLength);

    expect(envelope).toHaveLength(PUBLIC_SHARE_ENCRYPTED_DATA_KEY_LEGACY_V0_BYTES);
    expect(openPublicShareEncryptedDataKeyEnvelopeV0({ envelope, wrappingKey })).toEqual(dataKey);
  });

  it('rejects unauthenticated, malformed, and wrong-sized data-key payloads', () => {
    const wrappingKey = new Uint8Array(32).fill(7);
    const envelope = sealPublicShareEncryptedDataKeyEnvelopeV0({
      dataKey: new Uint8Array(32).fill(2),
      wrappingKey,
      randomBytes: (length) => new Uint8Array(length).fill(3),
    });
    envelope[envelope.byteLength - 1] ^= 1;

    expect(openPublicShareEncryptedDataKeyEnvelopeV0({ envelope, wrappingKey })).toBeNull();
    expect(() => sealPublicShareEncryptedDataKeyEnvelopeV0({
      dataKey: new Uint8Array(31),
      wrappingKey,
      randomBytes: (length) => new Uint8Array(length),
    })).toThrow('Public-share data key must be 32 bytes');
  });

  it('rejects a current-length envelope whose authenticated payload key is not 32 bytes', async () => {
    const tweetnacl = (await import('tweetnacl')).default;
    const { stringifySerializedJsonValue } = await import('./serializedJsonValue.js');
    const wrappingKey = new Uint8Array(32).fill(23);
    const nonce = new Uint8Array(tweetnacl.secretbox.nonceLength).fill(13);
    // A 31-byte key base64-encodes to the same fixed-width 44-char body, so
    // the sealed envelope keeps the accepted current length and must fail on
    // payload admission rather than envelope length alone.
    const shortKeyB64 = Buffer.from(new Uint8Array(31).fill(8)).toString('base64');
    const boxed = tweetnacl.secretbox(
      new TextEncoder().encode(stringifySerializedJsonValue({ v: 0, keyB64: shortKeyB64 })),
      nonce,
      wrappingKey,
    );
    const envelope = new Uint8Array(nonce.byteLength + boxed.byteLength);
    envelope.set(nonce);
    envelope.set(boxed, nonce.byteLength);

    expect(envelope).toHaveLength(PUBLIC_SHARE_ENCRYPTED_DATA_KEY_CURRENT_V0_BYTES);
    expect(openPublicShareEncryptedDataKeyEnvelopeV0({ envelope, wrappingKey })).toBeNull();
  });
});
