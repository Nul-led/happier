import { createServerUrlComparableKey, decodeBase64, encodeBase64 } from '@happier-dev/protocol';

export type TerminalAuthApprovalRequest = Readonly<{
  publicKey: string;
  pairing?: Readonly<{ secretB64Url: string; createdAtMs: number; expiresAtMs: number }>;
  supportsTokenOnly?: boolean;
}>;

/** Accept the existing request JSON or private pending state without retaining its private key. */
export function parseTerminalAuthApprovalRequestPacket(
  value: unknown,
  allowedServerUrls: readonly string[],
): TerminalAuthApprovalRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid auth request file');
  const packet = value as Record<string, unknown>;
  if (typeof packet.publicKey !== 'string') throw new Error('Invalid auth request (publicKey)');
  let publicKey: string;
  try {
    const key = decodeBase64(packet.publicKey, /[-_]/.test(packet.publicKey) ? 'base64url' : 'base64');
    if (key.length !== 32) throw new Error('Invalid key length');
    publicKey = encodeBase64(key);
  } catch { throw new Error('Invalid auth request (publicKey)'); }
  for (const field of ['serverUrl', 'publicServerUrl'] as const) {
    const url = packet[field];
    if (url === undefined) continue;
    if (typeof url !== 'string' || !allowedServerUrls.some((allowed) => {
      try { return createServerUrlComparableKey(url) === createServerUrlComparableKey(allowed); }
      catch { return false; }
    })) throw new Error('Auth request belongs to a different relay. Select the matching server before approval.');
  }
  const hasPairing = packet.pairing !== undefined || packet.pairingSecret !== undefined
    || packet.pairingCreatedAtMs !== undefined || packet.pairingExpiresAtMs !== undefined;
  if (!hasPairing) {
    if (packet.pairingRequirement === 'v3') throw new Error('Authenticated terminal pairing context is missing. Create a new auth request.');
    return { publicKey };
  }
  const pairing = packet.pairing !== undefined
    ? packet.pairing as Record<string, unknown>
    : { secretB64Url: packet.pairingSecret, createdAtMs: packet.pairingCreatedAtMs, expiresAtMs: packet.pairingExpiresAtMs };
  if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)
    || typeof pairing.secretB64Url !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing.secretB64Url)
    || decodeBase64(pairing.secretB64Url, 'base64url').length !== 32
    || !Number.isSafeInteger(pairing.createdAtMs) || !Number.isSafeInteger(pairing.expiresAtMs)
    || (pairing.createdAtMs as number) < 0 || (pairing.expiresAtMs as number) <= (pairing.createdAtMs as number)) {
    throw new Error('Invalid authenticated terminal pairing context');
  }
  const createdAtMs = pairing.createdAtMs as number;
  const expiresAtMs = pairing.expiresAtMs as number;
  const nowMs = Date.now();
  // The recipient minted this window on its clock and enforces its lower bound
  // when opening the authenticated response. The approver must not compare that
  // lower bound with a different machine's clock.
  if (expiresAtMs <= nowMs) throw new Error('Terminal pairing request expired. Create a new auth request.');
  return {
    publicKey,
    pairing: { secretB64Url: pairing.secretB64Url, createdAtMs, expiresAtMs },
    supportsTokenOnly: packet.supportsTokenOnly === true,
  };
}
