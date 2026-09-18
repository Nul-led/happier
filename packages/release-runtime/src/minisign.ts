import { ed25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { toByteArray } from 'base64-js';

/**
 * Pure cross-runtime Minisign verification.
 *
 * This module is imported by Node release tooling, the web/native/desktop
 * clients and the Happier Runner package assembler, so it must not reach for
 * Node crypto, the Node `Buffer` global, the filesystem or the network.
 */

const ED25519_ALGORITHM = new Uint8Array([0x45, 0x64]); // 'Ed', legacy detached signature
const ED25519_PREHASHED_ALGORITHM = new Uint8Array([0x45, 0x44]); // 'ED', BLAKE2b-512 prehashed

// Cofactorless RFC 8032 verification, matching the libsodium/OpenSSL behaviour
// every released Happier artifact was verified with before this core existed.
const ED25519_VERIFY_OPTIONS = { zip215: false } as const;

export const DEFAULT_MINISIGN_PUBLIC_KEY = `untrusted comment: minisign public key 91AE28177BF6E43C
RWQ85PZ7FyiukYbL3qv/bKnwgbT68wLVzotapeMFIb8n+c7pBQ7U8W2t
`;

function decodeBase64Line(line: string, expectedBytes: number): Uint8Array {
  const bytes = toByteArray(String(line ?? '').trim());
  if (bytes.length !== expectedBytes) {
    throw new Error(`[minisign] expected ${expectedBytes} bytes, got ${bytes.length}`);
  }
  return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function parseMinisignPublicKeyFile(pubkeyFile: string): Readonly<{
  signatureAlgorithm: Uint8Array;
  keyId: Uint8Array;
  rawPublicKey: Uint8Array;
}> {
  const lines = String(pubkeyFile ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error('[minisign] invalid public key file');
  const bytes = decodeBase64Line(lines[lines.length - 1] ?? '', 42);
  return {
    signatureAlgorithm: bytes.subarray(0, 2),
    keyId: bytes.subarray(2, 10),
    rawPublicKey: bytes.subarray(10, 42),
  };
}

function parseMinisignSignatureFile(sigFile: string): Readonly<{
  signatureAlgorithm: Uint8Array;
  keyId: Uint8Array;
  signature: Uint8Array;
  trustedSuffix: Uint8Array;
  globalSignature: Uint8Array;
}> {
  const lines = String(sigFile ?? '').split('\n');
  if (lines.length < 4) throw new Error('[minisign] invalid signature file');

  const untrustedBytes = decodeBase64Line(String(lines[1] ?? ''), 74);
  const trustedComment = String(lines[2] ?? '');
  if (!trustedComment.startsWith('trusted comment: ')) {
    throw new Error('[minisign] unexpected trusted comment format');
  }

  return {
    signatureAlgorithm: untrustedBytes.subarray(0, 2),
    keyId: untrustedBytes.subarray(2, 10),
    signature: untrustedBytes.subarray(10, 74),
    trustedSuffix: utf8Bytes(trustedComment.slice('trusted comment: '.length)),
    globalSignature: decodeBase64Line(String(lines[3] ?? ''), 64),
  };
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const out = new Uint8Array(first.length + second.length);
  out.set(first);
  out.set(second, first.length);
  return out;
}

export function verifyMinisign(params: Readonly<{
  message: string | Uint8Array;
  pubkeyFile: string;
  sigFile: string;
}>): boolean {
  try {
    const message = typeof params.message === 'string'
      ? utf8Bytes(params.message)
      : (params.message ?? new Uint8Array());
    const pubkey = parseMinisignPublicKeyFile(params.pubkeyFile);
    const sig = parseMinisignSignatureFile(params.sigFile);

    if (!bytesEqual(pubkey.signatureAlgorithm, ED25519_ALGORITHM)) return false;
    if (!bytesEqual(pubkey.keyId, sig.keyId)) return false;

    let payload: Uint8Array;
    if (bytesEqual(sig.signatureAlgorithm, ED25519_ALGORITHM)) {
      payload = message;
    } else if (bytesEqual(sig.signatureAlgorithm, ED25519_PREHASHED_ALGORITHM)) {
      payload = blake2b(message, { dkLen: 64 });
    } else {
      return false;
    }

    if (!ed25519.verify(sig.signature, payload, pubkey.rawPublicKey, ED25519_VERIFY_OPTIONS)) return false;
    return ed25519.verify(
      sig.globalSignature,
      concatBytes(sig.signature, sig.trustedSuffix),
      pubkey.rawPublicKey,
      ED25519_VERIFY_OPTIONS,
    );
  } catch {
    return false;
  }
}
