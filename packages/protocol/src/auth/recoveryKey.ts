import { decodeBase64, encodeBase64 } from '../crypto/base64.js';

const RECOVERY_KEY_BYTE_LENGTH = 32;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

type RecoveryKeyParseInvalidReason =
  | 'empty'
  | 'unsupported_characters'
  | 'invalid_encoding'
  | 'invalid_length';

type RecoveryKeyParseResult =
  | Readonly<{ ok: true; bytes: Uint8Array }>
  | Readonly<{ ok: false; reason: RecoveryKeyParseInvalidReason; byteLength?: number }>;

function bytesToBase32(bytes: Uint8Array): string {
  let result = '';
  let buffer = 0;
  let bufferLength = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bufferLength += 8;
    while (bufferLength >= 5) {
      bufferLength -= 5;
      result += BASE32_ALPHABET[(buffer >> bufferLength) & 0x1f];
    }
  }

  if (bufferLength > 0) {
    result += BASE32_ALPHABET[(buffer << (5 - bufferLength)) & 0x1f];
  }
  return result;
}

function base32ToBytes(base32: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bufferLength = 0;

  for (const char of base32) {
    const value = BASE32_ALPHABET.indexOf(char);
    buffer = (buffer << 5) | value;
    bufferLength += 5;
    if (bufferLength >= 8) {
      bufferLength -= 8;
      bytes.push((buffer >> bufferLength) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function parseRawBase64(input: string): RecoveryKeyParseResult | null {
  const compact = input;
  if (compact.length < 43 || compact.length > 45) return null;
  if (!/^[A-Za-z0-9+/_=-]+$/u.test(compact)) {
    return { ok: false, reason: 'invalid_encoding' };
  }

  const bytes = decodeBase64(compact, 'base64url');
  if (bytes.byteLength !== RECOVERY_KEY_BYTE_LENGTH) {
    return { ok: false, reason: 'invalid_length', byteLength: bytes.byteLength };
  }

  const base64 = encodeBase64(bytes, 'base64');
  const base64Url = encodeBase64(bytes, 'base64url');
  const accepted = new Set([
    base64,
    base64.replace(/=+$/u, ''),
    base64Url,
    `${base64Url}=`,
  ]);
  return accepted.has(compact)
    ? { ok: true, bytes }
    : { ok: false, reason: 'invalid_encoding' };
}

export function parseRecoveryKey(input: string): RecoveryKeyParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };

  const raw = parseRawBase64(trimmed);
  if (raw) return raw;

  const displayForm = trimmed
    .toUpperCase()
    .replace(/0/gu, 'O')
    .replace(/1/gu, 'I')
    .replace(/8/gu, 'B')
    .replace(/9/gu, 'G');
  if (!/^[A-Z2-7\s-]+$/u.test(displayForm)) {
    return { ok: false, reason: 'unsupported_characters' };
  }
  const cleaned = displayForm.replace(/[\s-]/gu, '');

  const bytes = base32ToBytes(cleaned);
  if (bytes.byteLength !== RECOVERY_KEY_BYTE_LENGTH) {
    return { ok: false, reason: 'invalid_length', byteLength: bytes.byteLength };
  }
  if (bytesToBase32(bytes) !== cleaned) {
    return { ok: false, reason: 'invalid_encoding' };
  }
  return { ok: true, bytes };
}

export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.byteLength !== RECOVERY_KEY_BYTE_LENGTH) {
    throw new Error(
      `Invalid recovery key: expected ${RECOVERY_KEY_BYTE_LENGTH} bytes, got ${bytes.byteLength}`,
    );
  }
  const base32 = bytesToBase32(bytes);
  const groups: string[] = [];
  for (let index = 0; index < base32.length; index += 5) {
    groups.push(base32.slice(index, index + 5));
  }
  return groups.join('-');
}

export function normalizeRecoveryKey(input: string): string {
  const result = parseRecoveryKey(input);
  if (!result.ok) {
    if (result.reason === 'invalid_length') {
      throw new Error(
        `Invalid key length: expected ${RECOVERY_KEY_BYTE_LENGTH} bytes, got ${result.byteLength}`,
      );
    }
    if (result.reason === 'unsupported_characters' || result.reason === 'empty') {
      throw new Error('No valid characters found');
    }
    throw new Error('Invalid recovery key encoding');
  }
  return encodeBase64(result.bytes, 'base64url');
}

export function isValidRecoveryKey(input: string): boolean {
  return parseRecoveryKey(input).ok;
}
