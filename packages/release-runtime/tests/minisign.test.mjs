import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyMinisign, DEFAULT_MINISIGN_PUBLIC_KEY } from '../dist/minisign.js';
import {
  CHECKSUMS_TEXT,
  PUBLIC_KEY_FILE,
  SIGNATURE_FILE_ED,
  SIGNATURE_FILE_PREHASHED,
  UNRELATED_PUBLIC_KEY_FILE,
  replaceSignatureLine,
} from './fixtures/minisignVectors.mjs';

const MESSAGE = new TextEncoder().encode(CHECKSUMS_TEXT);

function decodeKeyLine(pubkeyFile) {
  return Buffer.from(pubkeyFile.trim().split('\n').at(-1).trim(), 'base64');
}

function encodeKeyFile(bytes) {
  return `untrusted comment: minisign public key\n${Buffer.from(bytes).toString('base64')}\n`;
}

function decodeSignatureLine(sigFile) {
  return Buffer.from(sigFile.split('\n')[1].trim(), 'base64');
}

function encodeSignatureLine(bytes) {
  return Buffer.from(bytes).toString('base64');
}

test('the shipped default public key is the released Happier signing key', () => {
  assert.equal(
    DEFAULT_MINISIGN_PUBLIC_KEY,
    'untrusted comment: minisign public key 91AE28177BF6E43C\n'
      + 'RWQ85PZ7FyiukYbL3qv/bKnwgbT68wLVzotapeMFIb8n+c7pBQ7U8W2t\n',
  );
});

test('verifyMinisign accepts the pinned legacy Ed vector', () => {
  assert.equal(verifyMinisign({ message: MESSAGE, pubkeyFile: PUBLIC_KEY_FILE, sigFile: SIGNATURE_FILE_ED }), true);
});

test('verifyMinisign accepts the pinned prehashed ED vector', () => {
  assert.equal(
    verifyMinisign({ message: MESSAGE, pubkeyFile: PUBLIC_KEY_FILE, sigFile: SIGNATURE_FILE_PREHASHED }),
    true,
  );
});

test('verifyMinisign accepts text messages identically to their bytes', () => {
  assert.equal(verifyMinisign({ message: CHECKSUMS_TEXT, pubkeyFile: PUBLIC_KEY_FILE, sigFile: SIGNATURE_FILE_ED }), true);
  assert.equal(
    verifyMinisign({ message: CHECKSUMS_TEXT, pubkeyFile: PUBLIC_KEY_FILE, sigFile: SIGNATURE_FILE_PREHASHED }),
    true,
  );
});

test('verifyMinisign rejects a tampered message for both algorithms', () => {
  const tampered = new TextEncoder().encode(CHECKSUMS_TEXT.replace('a172b3b5', 'a172b3b6'));
  assert.equal(verifyMinisign({ message: tampered, pubkeyFile: PUBLIC_KEY_FILE, sigFile: SIGNATURE_FILE_ED }), false);
  assert.equal(
    verifyMinisign({ message: tampered, pubkeyFile: PUBLIC_KEY_FILE, sigFile: SIGNATURE_FILE_PREHASHED }),
    false,
  );
});

test('verifyMinisign rejects an unrelated signing key', () => {
  assert.equal(
    verifyMinisign({ message: MESSAGE, pubkeyFile: UNRELATED_PUBLIC_KEY_FILE, sigFile: SIGNATURE_FILE_ED }),
    false,
  );
});

test('verifyMinisign rejects a key identifier that does not match the signature', () => {
  const keyBytes = decodeKeyLine(PUBLIC_KEY_FILE);
  keyBytes[2] ^= 0xff;
  assert.equal(
    verifyMinisign({ message: MESSAGE, pubkeyFile: encodeKeyFile(keyBytes), sigFile: SIGNATURE_FILE_ED }),
    false,
  );
});

test('verifyMinisign rejects a public key that does not declare the Ed algorithm', () => {
  const keyBytes = decodeKeyLine(PUBLIC_KEY_FILE);
  keyBytes.write('ED', 0, 'utf-8');
  assert.equal(
    verifyMinisign({ message: MESSAGE, pubkeyFile: encodeKeyFile(keyBytes), sigFile: SIGNATURE_FILE_ED }),
    false,
  );
});

test('verifyMinisign rejects an unsupported signature algorithm', () => {
  const sigBytes = decodeSignatureLine(SIGNATURE_FILE_ED);
  sigBytes.write('EX', 0, 'utf-8');
  assert.equal(
    verifyMinisign({
      message: MESSAGE,
      pubkeyFile: PUBLIC_KEY_FILE,
      sigFile: replaceSignatureLine(SIGNATURE_FILE_ED, 1, encodeSignatureLine(sigBytes)),
    }),
    false,
  );
});

test('verifyMinisign rejects an Ed signature relabelled as prehashed ED', () => {
  const sigBytes = decodeSignatureLine(SIGNATURE_FILE_ED);
  sigBytes.write('ED', 0, 'utf-8');
  assert.equal(
    verifyMinisign({
      message: MESSAGE,
      pubkeyFile: PUBLIC_KEY_FILE,
      sigFile: replaceSignatureLine(SIGNATURE_FILE_ED, 1, encodeSignatureLine(sigBytes)),
    }),
    false,
  );
});

test('verifyMinisign rejects a tampered trusted comment', () => {
  assert.equal(
    verifyMinisign({
      message: MESSAGE,
      pubkeyFile: PUBLIC_KEY_FILE,
      sigFile: replaceSignatureLine(SIGNATURE_FILE_ED, 2, 'trusted comment: attacker supplied'),
    }),
    false,
  );
});

test('verifyMinisign rejects a missing trusted comment prefix', () => {
  assert.equal(
    verifyMinisign({
      message: MESSAGE,
      pubkeyFile: PUBLIC_KEY_FILE,
      sigFile: replaceSignatureLine(SIGNATURE_FILE_ED, 2, 'timestamp:1757030400'),
    }),
    false,
  );
});

test('verifyMinisign rejects truncated and malformed inputs without throwing', () => {
  assert.equal(verifyMinisign({ message: MESSAGE, pubkeyFile: PUBLIC_KEY_FILE, sigFile: 'bad\nsig\nfile\n' }), false);
  assert.equal(verifyMinisign({ message: MESSAGE, pubkeyFile: '', sigFile: SIGNATURE_FILE_ED }), false);
  assert.equal(
    verifyMinisign({
      message: MESSAGE,
      pubkeyFile: PUBLIC_KEY_FILE,
      sigFile: replaceSignatureLine(SIGNATURE_FILE_ED, 1, 'AAAA'),
    }),
    false,
  );
});
