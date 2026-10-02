import tweetnacl from 'tweetnacl';

import { decodeBase64, encodeBase64 } from './base64.js';
import { parseSerializedJsonValue, stringifySerializedJsonValue } from './serializedJsonValue.js';
import { deriveKey } from './keyDerivation.js';

export const PUBLIC_SHARE_DATA_ENCRYPTION_KEY_BYTES = 32;
export const PUBLIC_SHARE_WRAPPING_KEY_BYTES = tweetnacl.secretbox.keyLength;
export const PUBLIC_SHARE_KEY_DERIVATION_USAGE_V1 = 'Happy Public Share';
export const PUBLIC_SHARE_KEY_DERIVATION_PATH_V1 = Object.freeze(['v1'] as const);

/** Same deployed derivation; current callers supply the local URL-fragment secret. */
export function derivePublicShareWrappingKeyV1(secret: string): Uint8Array {
  if (!secret) throw new Error('Public-share secret is required');
  return deriveKey(new TextEncoder().encode(secret), PUBLIC_SHARE_KEY_DERIVATION_USAGE_V1, PUBLIC_SHARE_KEY_DERIVATION_PATH_V1);
}

export function sealPublicShareDataKeyV1(params: Readonly<{
  dataKey: Uint8Array;
  secret: string;
  randomBytes: (length: number) => Uint8Array;
}>): string {
  return encodeBase64(sealPublicShareEncryptedDataKeyEnvelopeV0({
    dataKey: params.dataKey, wrappingKey: derivePublicShareWrappingKeyV1(params.secret), randomBytes: params.randomBytes,
  }), 'base64');
}

/** A failed fragment never falls back to a server-visible lookup id. */
export function openPublicShareDataKeyV1(params: Readonly<{ encryptedDataKey: string; secret: string }>): Uint8Array | null {
  try {
    return openPublicShareEncryptedDataKeyEnvelopeV0({
      envelope: decodeBase64(params.encryptedDataKey, 'base64'), wrappingKey: derivePublicShareWrappingKeyV1(params.secret),
    });
  } catch {
    return null;
  }
}
const DATA_KEY_BASE64_LENGTH = Math.ceil(PUBLIC_SHARE_DATA_ENCRYPTION_KEY_BYTES / 3) * 4;
const DATA_KEY_BASE64_PLACEHOLDER = 'A'.repeat(DATA_KEY_BASE64_LENGTH);
const SECRETBOX_OVERHEAD_BYTES = tweetnacl.secretbox.nonceLength + tweetnacl.secretbox.overheadLength;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const PUBLIC_SHARE_ENCRYPTED_DATA_KEY_LEGACY_V0_BYTES =
  SECRETBOX_OVERHEAD_BYTES + utf8Length(JSON.stringify({ v: 0, keyB64: DATA_KEY_BASE64_PLACEHOLDER }));
export const PUBLIC_SHARE_ENCRYPTED_DATA_KEY_CURRENT_V0_BYTES =
  SECRETBOX_OVERHEAD_BYTES + utf8Length(
    stringifySerializedJsonValue({ v: 0, keyB64: DATA_KEY_BASE64_PLACEHOLDER }),
  );

export type PublicShareEncryptedDataKeyEnvelopeV0 = Readonly<{
  format: 'legacy-json' | 'serialized-json-v1';
  encryptedDataKey: Uint8Array<ArrayBuffer>;
}>;

type PublicShareDataKeyPayloadV0 = Readonly<{
  v: 0;
  keyB64: string;
}>;

function readPublicShareDataKeyPayloadV0(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.v !== 0 || typeof candidate.keyB64 !== 'string') return null;
  try {
    const decoded = decodeBase64(candidate.keyB64, 'base64');
    if (
      decoded.byteLength !== PUBLIC_SHARE_DATA_ENCRYPTION_KEY_BYTES
      || encodeBase64(decoded, 'base64') !== candidate.keyB64
    ) return null;
    const copy = new Uint8Array(decoded.byteLength);
    copy.set(decoded);
    return copy;
  } catch {
    return null;
  }
}

function serializeCurrentPublicShareDataKeyPayloadV0(dataKey: Uint8Array): Uint8Array {
  const payload: PublicShareDataKeyPayloadV0 = {
    v: 0,
    keyB64: encodeBase64(dataKey, 'base64'),
  };
  return new TextEncoder().encode(stringifySerializedJsonValue(payload));
}

export function parsePublicShareEncryptedDataKeyEnvelopeV0(
  bytes: Uint8Array,
): PublicShareEncryptedDataKeyEnvelopeV0 | null {
  const encryptedDataKey = new Uint8Array(bytes.byteLength);
  encryptedDataKey.set(bytes);
  if (bytes.byteLength === PUBLIC_SHARE_ENCRYPTED_DATA_KEY_CURRENT_V0_BYTES) {
    return { format: 'serialized-json-v1', encryptedDataKey };
  }
  if (bytes.byteLength === PUBLIC_SHARE_ENCRYPTED_DATA_KEY_LEGACY_V0_BYTES) {
    return { format: 'legacy-json', encryptedDataKey };
  }
  return null;
}

/** Current writer for the deployed V0 SecretBox envelope. */
export function sealPublicShareEncryptedDataKeyEnvelopeV0(params: Readonly<{
  dataKey: Uint8Array;
  wrappingKey: Uint8Array;
  randomBytes: (length: number) => Uint8Array;
}>): Uint8Array<ArrayBuffer> {
  if (params.dataKey.byteLength !== PUBLIC_SHARE_DATA_ENCRYPTION_KEY_BYTES) {
    throw new Error(`Public-share data key must be ${PUBLIC_SHARE_DATA_ENCRYPTION_KEY_BYTES} bytes`);
  }
  if (params.wrappingKey.byteLength !== PUBLIC_SHARE_WRAPPING_KEY_BYTES) {
    throw new Error(`Public-share wrapping key must be ${PUBLIC_SHARE_WRAPPING_KEY_BYTES} bytes`);
  }
  const nonce = params.randomBytes(tweetnacl.secretbox.nonceLength);
  if (nonce.byteLength !== tweetnacl.secretbox.nonceLength) {
    throw new Error(`Public-share nonce must be ${tweetnacl.secretbox.nonceLength} bytes`);
  }
  const boxed = tweetnacl.secretbox(
    serializeCurrentPublicShareDataKeyPayloadV0(params.dataKey),
    nonce,
    params.wrappingKey,
  );
  const envelope = new Uint8Array(nonce.byteLength + boxed.byteLength);
  envelope.set(nonce);
  envelope.set(boxed, nonce.byteLength);
  return envelope;
}

/** Reads both the current serialized payload and the deployed legacy JSON payload. */
export function openPublicShareEncryptedDataKeyEnvelopeV0(params: Readonly<{
  envelope: Uint8Array;
  wrappingKey: Uint8Array;
}>): Uint8Array<ArrayBuffer> | null {
  if (
    params.wrappingKey.byteLength !== PUBLIC_SHARE_WRAPPING_KEY_BYTES
    || parsePublicShareEncryptedDataKeyEnvelopeV0(params.envelope) === null
  ) return null;
  try {
    const nonce = params.envelope.slice(0, tweetnacl.secretbox.nonceLength);
    const boxed = params.envelope.slice(tweetnacl.secretbox.nonceLength);
    const plaintext = tweetnacl.secretbox.open(boxed, nonce, params.wrappingKey);
    if (!plaintext) return null;
    const serialized = new TextDecoder().decode(plaintext);
    const payload = parseSerializedJsonValue(serialized);
    return readPublicShareDataKeyPayloadV0(payload);
  } catch {
    return null;
  }
}
