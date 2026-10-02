import { vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sealTerminalProvisioningV3Payload } from '@happier-dev/protocol';

/** Native approver fixture: read context from the emitted QR/deep link, never the relay request. */
export function approvePrintedTerminalPairing(recipientPublicKey: Uint8Array, contentPrivateKey: Uint8Array): string {
  const text = vi.mocked(console.log).mock.calls.flat().map(String).join('\n');
  const links = text.match(/(?:happier:\/\/terminal\?|https?:\/\/[^\s\u001b]+\/terminal\/connect#)[^\s\u001b]+/g) ?? [];
  const link = links.at(-1);
  if (!link) throw new Error('Missing emitted terminal pairing link');
  const url = new URL(link);
  const query = new URLSearchParams(url.hash ? url.hash.slice(1) : url.search);
  const key = query.get('key');
  if (!key || !Buffer.from(key, 'base64url').equals(Buffer.from(recipientPublicKey))) throw new Error('Pairing link key mismatch');
  const secret = query.get('pairingSecret');
  if (!secret) throw new Error('Missing pairing secret in emitted link');
  return Buffer.from(sealTerminalProvisioningV3Payload({
    terminalEphemeralPublicKey: recipientPublicKey,
    contentPrivateKey,
    pairingSecret: new Uint8Array(Buffer.from(secret, 'base64url')),
    createdAtMs: Number(query.get('createdAt')),
    expiresAtMs: Number(query.get('expiresAt')),
    randomBytes: (length) => new Uint8Array(randomBytes(length)),
  })).toString('base64');
}
