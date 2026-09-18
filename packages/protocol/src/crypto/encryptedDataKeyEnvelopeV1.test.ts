import { describe, expect, it } from 'vitest';

import { sha512 } from '@noble/hashes/sha512';
import tweetnacl from 'tweetnacl';

import { openBoxBundle } from './boxBundle.js';
import { CRYPTO_GOLDEN_VECTORS } from './cryptoGoldenVectors.js';
import {
  ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES,
  openEncryptedDataKeyEnvelopeV1,
  parseEncryptedDataKeyEnvelopeV1,
  sealEncryptedDataKeyEnvelopeV1,
} from './encryptedDataKeyEnvelopeV1.js';

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

function deterministicRandomBytesFactory(): (length: number) => Uint8Array {
  let counter = 1;
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = counter & 0xff;
      counter++;
    }
    return out;
  };
}

describe('encryptedDataKeyEnvelopeV1', () => {
  it('parses the exact envelope shape emitted for a 32-byte data key', () => {
    const recipientSecretKey = new Uint8Array(32).fill(9);
    const recipientPublicKey = tweetnacl.box.keyPair.fromSecretKey(recipientSecretKey).publicKey;
    const envelope = sealEncryptedDataKeyEnvelopeV1({
      dataKey: new Uint8Array(32).fill(4),
      recipientPublicKey,
      randomBytes: deterministicRandomBytesFactory(),
    });

    const parsed = parseEncryptedDataKeyEnvelopeV1(envelope);

    expect(envelope).toHaveLength(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES);
    expect(parsed?.encryptedDataKey).toEqual(envelope);
    expect(parsed?.encryptedDataKey).not.toBe(envelope);
  });

  it('rejects unsupported versions and non-conforming envelope lengths', () => {
    const validLengthEnvelope = new Uint8Array(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES);
    const unsupportedVersion = new Uint8Array(validLengthEnvelope);
    unsupportedVersion[0] = 1;

    expect(parseEncryptedDataKeyEnvelopeV1(unsupportedVersion)).toBeNull();
    expect(parseEncryptedDataKeyEnvelopeV1(validLengthEnvelope.slice(0, -1))).toBeNull();
    expect(parseEncryptedDataKeyEnvelopeV1(
      new Uint8Array(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES + 1),
    )).toBeNull();
  });

  it('seals and opens a v1 envelope with recipient secret key', () => {
    const recipientSecretKey = new Uint8Array(32).fill(9);
    const recipientPublicKey = tweetnacl.box.keyPair.fromSecretKey(recipientSecretKey).publicKey;
    const dataKey = new Uint8Array(32).fill(4);

    const envelope = sealEncryptedDataKeyEnvelopeV1({
      dataKey,
      recipientPublicKey,
      randomBytes: deterministicRandomBytesFactory(),
    });

    const opened = openEncryptedDataKeyEnvelopeV1({
      envelope,
      recipientSecretKeyOrSeed: recipientSecretKey,
    });

    expect(opened).not.toBeNull();
    expect(Array.from(opened!)).toEqual(Array.from(dataKey));
  });

  it('returns null when the envelope is opened by a different recipient', () => {
    const recipientSecretKey = new Uint8Array(32).fill(9);
    const recipientPublicKey = tweetnacl.box.keyPair.fromSecretKey(recipientSecretKey).publicKey;
    const envelope = sealEncryptedDataKeyEnvelopeV1({
      dataKey: new Uint8Array(32).fill(4),
      recipientPublicKey,
      randomBytes: deterministicRandomBytesFactory(),
    });

    expect(openEncryptedDataKeyEnvelopeV1({
      envelope,
      recipientSecretKeyOrSeed: new Uint8Array(32).fill(10),
    })).toBeNull();
  });

  it('opens a v1 envelope when recipient secret key is provided as a seed (CLI compat)', () => {
    const seed = new Uint8Array(32).fill(11);
    const compatSecretKey = sha512(seed).slice(0, 32);
    const recipientPublicKey = tweetnacl.box.keyPair.fromSecretKey(compatSecretKey).publicKey;
    const dataKey = new Uint8Array(32).fill(1);

    const envelope = sealEncryptedDataKeyEnvelopeV1({
      dataKey,
      recipientPublicKey,
      randomBytes: deterministicRandomBytesFactory(),
    });

    const opened = openEncryptedDataKeyEnvelopeV1({
      envelope,
      recipientSecretKeyOrSeed: seed,
    });

    expect(opened).not.toBeNull();
    expect(Array.from(opened!)).toEqual(Array.from(dataKey));
  });

  it('returns null when envelope version byte is unsupported', () => {
    const recipientSecretKey = new Uint8Array(32).fill(9);
    const recipientPublicKey = tweetnacl.box.keyPair.fromSecretKey(recipientSecretKey).publicKey;
    const dataKey = new Uint8Array(32).fill(4);

    const envelope = sealEncryptedDataKeyEnvelopeV1({
      dataKey,
      recipientPublicKey,
      randomBytes: deterministicRandomBytesFactory(),
    });
    const mutated = new Uint8Array(envelope);
    mutated[0] = 99;

    expect(openEncryptedDataKeyEnvelopeV1({ envelope: mutated, recipientSecretKeyOrSeed: recipientSecretKey })).toBeNull();
  });

  it('returns null (and does not throw) when envelope is malformed', () => {
    const seed = new Uint8Array(32).fill(1);
    expect(openEncryptedDataKeyEnvelopeV1({ envelope: new Uint8Array([0, 1, 2]), recipientSecretKeyOrSeed: seed })).toBeNull();
  });

  it('opens the independent fixed 105-byte vector to its exact 32-byte data key', () => {
    const vector = CRYPTO_GOLDEN_VECTORS.encryptedDataKeyEnvelopeV1.directSecretKey;
    const envelope = bytesFromHex(vector.envelope.hex);

    const opened = openEncryptedDataKeyEnvelopeV1({
      envelope,
      recipientSecretKeyOrSeed: bytesFromHex(vector.recipientSecretKeyOrSeed.hex),
    });

    expect(envelope).toHaveLength(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES);
    expect(opened).toHaveLength(32);
    expect(Buffer.from(opened!).toString('hex')).toBe(vector.dataKey.hex);
  });

  it('rejects cryptographically valid envelopes that wrap a 31- or 33-byte key', () => {
    for (const vector of [
      CRYPTO_GOLDEN_VECTORS.encryptedDataKeyEnvelopeV1.undersizedDataKeyEnvelope,
      CRYPTO_GOLDEN_VECTORS.encryptedDataKeyEnvelopeV1.oversizedDataKeyEnvelope,
    ]) {
      const envelope = bytesFromHex(vector.envelope.hex);
      const recipientSecretKeyOrSeed = bytesFromHex(vector.recipientSecretKeyOrSeed.hex);

      // The variable-length primitive still opens these bundles, so only the
      // fixed data-key contract can reject them.
      const openedBundle = openBoxBundle({
        bundle: envelope.slice(1),
        recipientSecretKeyOrSeed,
      });
      expect(openedBundle).not.toBeNull();
      expect(Buffer.from(openedBundle!).toString('hex')).toBe(vector.dataKey.hex);

      expect(envelope.length).not.toBe(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES);
      expect(openEncryptedDataKeyEnvelopeV1({ envelope, recipientSecretKeyOrSeed })).toBeNull();
      expect(parseEncryptedDataKeyEnvelopeV1(envelope)).toBeNull();
    }
  });

  it('refuses to seal a data key that is not exactly 32 bytes', () => {
    const recipientSecretKey = new Uint8Array(32).fill(9);
    const recipientPublicKey = tweetnacl.box.keyPair.fromSecretKey(recipientSecretKey).publicKey;

    for (const length of [31, 33]) {
      expect(() => sealEncryptedDataKeyEnvelopeV1({
        dataKey: new Uint8Array(length).fill(4),
        recipientPublicKey,
        randomBytes: deterministicRandomBytesFactory(),
      })).toThrow(/data key length/i);
    }
  });
});
