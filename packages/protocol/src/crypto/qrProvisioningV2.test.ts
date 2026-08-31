import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64.js';
import {
  HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS,
  HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES,
  HOME_QR_INVITE_V2_MAX_TTL_MS,
  HomeQrInviteV2Schema,
  type HomeQrInviteV2,
  computeHomeQrBindingProofV2,
  computeHomeQrConfirmationCodeV2,
  createHomeQrBindingInputV2,
  deriveHomeQrBindingKeyV2,
  deriveHomeQrRendezvousSecretV2,
  deriveHomeQrRendezvousVerifierV2,
  encodeHomeQrInviteV2Payload,
  parseHomeQrInviteV2Payload,
  verifyHomeQrBindingProofV2,
  verifyHomeQrRendezvousSecretV2,
  verifyHomeQrRendezvousVerifierV2,
} from './qrProvisioningV2.js';

// Fixed golden fixtures. Every expected byte string below was computed with an
// independent HMAC-SHA-256/SHA-256 implementation (Node crypto) over these exact
// inputs; none are derived through the functions under test.
const GOLDEN = {
  qrSecretBase64Url: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
  requesterPublicKeyHex: '0808080808080808080808080808080808080808080808080808080808080808',
  rendezvousSecretHex: 'dbd6b46487a573a1503b9e8f78276affbff593eb8a59fdfb951d485632b0bdcd',
  bindingKeyHex: 'b3909cede7dedd5a049d93565f9fd1ea8420fefd06e9c1bafe7e7ed3cc2b099c',
  bindingInputHex:
    '0000000276320000000b686f6d655f64657669636500000006706169722d31000000087372765f686f6d650000002008080808080808080808080808080808080808080808080808080808080808080000000432303030',
  bindingProofBase64Url: 'SpODqF_hkLT_xEsJnF-0ceTuYzh7eOiz1L8Q161668c',
  confirmationCode: '181480',
  rendezvousVerifierHex: '7564512c23402e8ad27d0b19a06264fbc9095273b1bc5824395cb9736a3b1349',
  invitePayloadNoLabel:
    'eyJleHBpcmVzQXRNcyI6NjEwMDAsImhvbWUiOnsiY2Fub25pY2FsU2VydmVyVXJsIjoiaHR0cHM6Ly9ob21lLmV4YW1wbGUiLCJlbmRwb2ludHMiOlt7ImtpbmQiOiJodHRwcyIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dLCJob21lU2VydmVySWRlbnRpdHlJZCI6InNydl9ob21lIiwicmV2aXNpb24iOjEsInYiOjF9LCJpbnRlbnQiOiJob21lX2RldmljZSIsImlzc3VlZEF0TXMiOjEwMDAsInBhaXJJZCI6InBhaXItMSIsInFyU2VjcmV0QmFzZTY0VXJsIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsInYiOjJ9',
  invitePayloadWithLabel:
    'eyJleHBpcmVzQXRNcyI6NjEwMDAsImhvbWUiOnsiY2Fub25pY2FsU2VydmVyVXJsIjoiaHR0cHM6Ly9ob21lLmV4YW1wbGUiLCJlbmRwb2ludHMiOlt7ImtpbmQiOiJodHRwcyIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dLCJob21lU2VydmVySWRlbnRpdHlJZCI6InNydl9ob21lIiwicmV2aXNpb24iOjEsInYiOjF9LCJpbnRlbnQiOiJob21lX2RldmljZSIsImlzc3VlZEF0TXMiOjEwMDAsInBhaXJJZCI6InBhaXItMSIsInFyU2VjcmV0QmFzZTY0VXJsIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsInJlcXVlc3RlZERldmljZUxhYmVsIjoiRGVzayBwaG9uZSIsInYiOjJ9',
} as const;

const QR_SECRET = new Uint8Array(32).fill(7);
const REQUESTER_PUBLIC_KEY = new Uint8Array(32).fill(8);

const BINDING_CONTEXT = {
  pairId: 'pair-1',
  homeServerIdentityId: 'srv_home',
  requesterPublicKey: REQUESTER_PUBLIC_KEY,
  expiresAtMs: 2_000,
} as const;

const BINDING_PARAMS = { qrSecret: QR_SECRET, ...BINDING_CONTEXT } as const;

const HOME = {
  v: 1,
  homeServerIdentityId: 'srv_home',
  canonicalServerUrl: 'https://home.example',
  revision: 1,
  endpoints: [{ kind: 'https', url: 'https://home.example' }],
} as const;

const INVITE_NO_LABEL: HomeQrInviteV2 = {
  v: 2,
  intent: 'home_device',
  pairId: 'pair-1',
  home: HOME,
  qrSecretBase64Url: GOLDEN.qrSecretBase64Url,
  issuedAtMs: 1_000,
  expiresAtMs: 61_000,
};

const INVITE_WITH_LABEL: HomeQrInviteV2 = {
  ...INVITE_NO_LABEL,
  requestedDeviceLabel: 'Desk phone',
};

const NOW_MS = 5_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jsonPayload(value: Record<string, unknown>): string {
  return encodeBase64(new TextEncoder().encode(JSON.stringify(value)), 'base64url');
}

describe('Home QR v2 domain derivation (golden vectors)', () => {
  it('derives the domain-separated rendezvous secret and binding key', () => {
    expect(bytesToHex(deriveHomeQrRendezvousSecretV2(QR_SECRET))).toBe(GOLDEN.rendezvousSecretHex);
    expect(bytesToHex(deriveHomeQrBindingKeyV2(QR_SECRET))).toBe(GOLDEN.bindingKeyHex);
    expect(deriveHomeQrRendezvousSecretV2(QR_SECRET)).not.toEqual(deriveHomeQrBindingKeyV2(QR_SECRET));
  });

  it('rejects QR secrets that are not exactly 32 bytes', () => {
    for (const length of [0, 1, 31, 33, 64]) {
      expect(() => deriveHomeQrRendezvousSecretV2(new Uint8Array(length))).toThrow();
      expect(() => deriveHomeQrBindingKeyV2(new Uint8Array(length))).toThrow();
    }
  });

  it('builds the canonical length-delimited binding input', () => {
    expect(bytesToHex(createHomeQrBindingInputV2(BINDING_CONTEXT))).toBe(GOLDEN.bindingInputHex);
  });

  it('requires an exactly 32-byte requester public key in the binding input', () => {
    for (const length of [0, 31, 33]) {
      expect(() => createHomeQrBindingInputV2({ ...BINDING_CONTEXT, requesterPublicKey: new Uint8Array(length) })).toThrow();
      expect(() => computeHomeQrBindingProofV2({ ...BINDING_PARAMS, requesterPublicKey: new Uint8Array(length) })).toThrow();
    }
  });

  it('computes the golden binding proof and confirmation code', () => {
    const proof = computeHomeQrBindingProofV2(BINDING_PARAMS);
    expect(proof).toBe(GOLDEN.bindingProofBase64Url);
    expect(proof).toHaveLength(43);
    expect(computeHomeQrConfirmationCodeV2(BINDING_PARAMS)).toBe(GOLDEN.confirmationCode);
    expect(computeHomeQrConfirmationCodeV2(BINDING_PARAMS)).toMatch(/^\d{6}$/u);
  });

  it('derives and verifies the rendezvous verifier', () => {
    const rendezvousSecret = deriveHomeQrRendezvousSecretV2(QR_SECRET);
    const verifier = deriveHomeQrRendezvousVerifierV2(QR_SECRET);
    expect(bytesToHex(verifier)).toBe(GOLDEN.rendezvousVerifierHex);
    expect(verifyHomeQrRendezvousSecretV2(rendezvousSecret, verifier)).toBe(true);
    expect(verifyHomeQrRendezvousSecretV2(QR_SECRET, verifier)).toBe(false);
    expect(verifyHomeQrRendezvousVerifierV2(QR_SECRET, verifier)).toBe(true);

    const tampered = verifier.slice();
    tampered[0] ^= 1;
    expect(verifyHomeQrRendezvousSecretV2(rendezvousSecret, tampered)).toBe(false);
    expect(verifyHomeQrRendezvousSecretV2(new Uint8Array(31), verifier)).toBe(false);
    expect(verifyHomeQrRendezvousSecretV2(rendezvousSecret, new Uint8Array(31))).toBe(false);
    expect(verifyHomeQrRendezvousVerifierV2(QR_SECRET, tampered)).toBe(false);
    expect(verifyHomeQrRendezvousVerifierV2(new Uint8Array(32).fill(9), verifier)).toBe(false);
  });
});

describe('Home QR v2 binding proof verification', () => {
  it('accepts the golden proof for the exact binding context', () => {
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, GOLDEN.bindingProofBase64Url)).toBe(true);
  });

  it('fails when any bound input changes', () => {
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, pairId: 'pair-2' }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, homeServerIdentityId: 'srv_other' }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, requesterPublicKey: new Uint8Array(32).fill(9) }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, expiresAtMs: 2_001 }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, qrSecret: new Uint8Array(32).fill(9) }, GOLDEN.bindingProofBase64Url)).toBe(false);
  });

  it('produces a different proof for each changed bound input', () => {
    const golden = computeHomeQrBindingProofV2(BINDING_PARAMS);
    expect(computeHomeQrBindingProofV2({ ...BINDING_PARAMS, pairId: 'pair-2' })).not.toBe(golden);
    expect(computeHomeQrBindingProofV2({ ...BINDING_PARAMS, homeServerIdentityId: 'srv_other' })).not.toBe(golden);
    expect(computeHomeQrBindingProofV2({ ...BINDING_PARAMS, requesterPublicKey: new Uint8Array(32).fill(9) })).not.toBe(golden);
    expect(computeHomeQrBindingProofV2({ ...BINDING_PARAMS, expiresAtMs: 2_001 })).not.toBe(golden);
    expect(computeHomeQrBindingProofV2({ ...BINDING_PARAMS, qrSecret: new Uint8Array(32).fill(9) })).not.toBe(golden);
  });

  it('rejects tampered, truncated, and malformed proof encodings', () => {
    const proof = computeHomeQrBindingProofV2(BINDING_PARAMS);
    const tampered = `${proof.slice(0, 42)}${proof.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, tampered)).toBe(false);
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, proof.slice(0, 42))).toBe(false);
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, `${proof}A`)).toBe(false);
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, 'not-a-proof!')).toBe(false);
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, '')).toBe(false);
  });

  it('a substituted requester key cannot produce a verifiable proof', () => {
    const attackerProof = computeHomeQrBindingProofV2({ ...BINDING_PARAMS, requesterPublicKey: new Uint8Array(32).fill(1) });
    expect(attackerProof).not.toBe(GOLDEN.bindingProofBase64Url);
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, attackerProof)).toBe(false);
  });
});

describe('Home QR v2 invite payload codec (golden vectors)', () => {
  it('encodes the canonical deterministic payload forms', () => {
    expect(encodeHomeQrInviteV2Payload(INVITE_NO_LABEL)).toBe(GOLDEN.invitePayloadNoLabel);
    expect(encodeHomeQrInviteV2Payload(INVITE_WITH_LABEL)).toBe(GOLDEN.invitePayloadWithLabel);
  });

  it('round-trips invites through the opaque bounded payload', () => {
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadNoLabel, { nowMs: NOW_MS })).toEqual(INVITE_NO_LABEL);
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadWithLabel, { nowMs: NOW_MS })).toEqual(INVITE_WITH_LABEL);
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(INVITE_WITH_LABEL), { nowMs: NOW_MS })).toEqual(INVITE_WITH_LABEL);
  });

  it('accepts a schema-valid invite at the TTL and skew boundaries', () => {
    const atMaxTtl: HomeQrInviteV2 = { ...INVITE_NO_LABEL, issuedAtMs: 0, expiresAtMs: HOME_QR_INVITE_V2_MAX_TTL_MS };
    const payload = encodeHomeQrInviteV2Payload(atMaxTtl);
    expect(parseHomeQrInviteV2Payload(payload, { nowMs: HOME_QR_INVITE_V2_MAX_TTL_MS })).toEqual(atMaxTtl);

    const atSkewEdge: HomeQrInviteV2 = {
      ...INVITE_NO_LABEL,
      issuedAtMs: NOW_MS + HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS,
      expiresAtMs: NOW_MS + HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS + 1_000,
    };
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(atSkewEdge), { nowMs: NOW_MS })).toEqual(atSkewEdge);
  });
});

describe('Home QR v2 invite strict rejection', () => {
  it('rejects unknown, missing, and out-of-contract fields', () => {
    const base = { ...INVITE_NO_LABEL };
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...base, extra: 1 }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...base, requestedDeviceLabel: null }), { nowMs: NOW_MS })).toBeNull();
    const { issuedAtMs: _dropped, ...missingIssued } = base;
    expect(parseHomeQrInviteV2Payload(jsonPayload(missingIssued), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...base, v: 3 }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...base, v: 1 }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...base, intent: 'account' }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...base, intent: 2 }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload([]), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload(null), { nowMs: NOW_MS })).toBeNull();
  });

  it('rejects oversized pair ids and labels', () => {
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_NO_LABEL, pairId: 'p'.repeat(129) }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_NO_LABEL, pairId: '' }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_NO_LABEL, requestedDeviceLabel: 'é'.repeat(65) }), { nowMs: NOW_MS })).toBeNull();
    expect(() => encodeHomeQrInviteV2Payload({ ...INVITE_NO_LABEL, requestedDeviceLabel: 'é'.repeat(65) })).toThrow();
  });

  it('rejects malformed base64url and non-canonical payloads', () => {
    expect(parseHomeQrInviteV2Payload('not-base64url!', { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(`${GOLDEN.invitePayloadNoLabel}=`, { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(encodeBase64(new TextEncoder().encode('not json'), 'base64url'), { nowMs: NOW_MS })).toBeNull();
    // Schema-valid invite serialized in non-canonical key order must be rejected.
    const nonCanonical = encodeBase64(
      new TextEncoder().encode(JSON.stringify({
        v: INVITE_NO_LABEL.v,
        intent: INVITE_NO_LABEL.intent,
        pairId: INVITE_NO_LABEL.pairId,
        home: INVITE_NO_LABEL.home,
        qrSecretBase64Url: INVITE_NO_LABEL.qrSecretBase64Url,
        issuedAtMs: INVITE_NO_LABEL.issuedAtMs,
        expiresAtMs: INVITE_NO_LABEL.expiresAtMs,
      })),
      'base64url',
    );
    expect(nonCanonical).not.toBe(GOLDEN.invitePayloadNoLabel);
    expect(parseHomeQrInviteV2Payload(nonCanonical, { nowMs: NOW_MS })).toBeNull();
  });

  it('rejects invalid and mismatched Home descriptors', () => {
    const cases: unknown[] = [
      { ...HOME, v: 2 },
      { ...HOME, homeServerIdentityId: '' },
      { ...HOME, canonicalServerUrl: 'ftp://home.example' },
      { ...HOME, canonicalServerUrl: 'https://user:pass@home.example' },
      { ...HOME, revision: 0 },
      { ...HOME, endpoints: [] },
      { ...HOME, endpointUnknown: true },
    ];
    for (const home of cases) {
      expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_NO_LABEL, home }), { nowMs: NOW_MS })).toBeNull();
    }
  });

  it('rejects QR secrets that are not exactly 32 canonical base64url bytes', () => {
    for (const length of [31, 33]) {
      const secret = encodeBase64(new Uint8Array(length), 'base64url');
      expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_NO_LABEL, qrSecretBase64Url: secret }), { nowMs: NOW_MS })).toBeNull();
      expect(() => encodeHomeQrInviteV2Payload({ ...INVITE_NO_LABEL, qrSecretBase64Url: secret })).toThrow();
    }
    // The final base64url character carries padding bits: this variant decodes to
    // the same 32 bytes but is not canonical, and must be rejected.
    const nonCanonicalSecret = `${GOLDEN.qrSecretBase64Url.slice(0, -1)}d`;
    expect(decodeBase64(nonCanonicalSecret, 'base64url')).toEqual(decodeBase64(GOLDEN.qrSecretBase64Url, 'base64url'));
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_NO_LABEL, qrSecretBase64Url: nonCanonicalSecret }), { nowMs: NOW_MS })).toBeNull();
  });

  it('rejects unsafe timestamps, expiry ordering, and excessive TTL', () => {
    const cases: Array<Partial<HomeQrInviteV2>> = [
      { issuedAtMs: 1.5 },
      { issuedAtMs: -1 },
      { issuedAtMs: 2 ** 60 },
      { expiresAtMs: 1.5 },
      { expiresAtMs: -1 },
      { expiresAtMs: 2 ** 60 },
      { expiresAtMs: 1_000 }, // expires == issued
      { expiresAtMs: 999 }, // expires < issued
      { expiresAtMs: 1_000 + HOME_QR_INVITE_V2_MAX_TTL_MS + 1 }, // TTL above the pairing maximum
    ];
    for (const patch of cases) {
      const invite = { ...INVITE_NO_LABEL, ...patch };
      expect(parseHomeQrInviteV2Payload(jsonPayload(invite as HomeQrInviteV2), { nowMs: NOW_MS })).toBeNull();
      expect(() => encodeHomeQrInviteV2Payload(invite as HomeQrInviteV2)).toThrow();
    }
  });

  it('rejects non-fresh invites against the caller-provided time', () => {
    // Expired.
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadNoLabel, { nowMs: 61_001 })).toBeNull();
    // The expiry instant itself remains valid.
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadNoLabel, { nowMs: 61_000 })).toEqual(INVITE_NO_LABEL);
    // Issued too far in the future.
    const future: HomeQrInviteV2 = { ...INVITE_NO_LABEL, issuedAtMs: NOW_MS + HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS + 1 };
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(future), { nowMs: NOW_MS })).toBeNull();
    // Unsafe nowMs fails closed.
    for (const nowMs of [Number.NaN, -1, 1.5, 2 ** 60]) {
      expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadNoLabel, { nowMs })).toBeNull();
    }
  });

  it('rejects oversized payloads on encode and parse', () => {
    const oversizedHome = {
      ...HOME,
      endpoints: Array.from({ length: 16 }, (_, endpointIndex) => ({
        kind: 'iroh' as const,
        endpointId: endpointIndex.toString(16).padStart(64, '0'),
        relayUrls: Array.from(
          { length: 8 },
          (_, relayIndex) => `https://relay-${relayIndex}.example/${'a'.repeat(470)}`,
        ),
      })),
    };
    const oversizedInvite: HomeQrInviteV2 = { ...INVITE_NO_LABEL, home: oversizedHome };
    expect(() => encodeHomeQrInviteV2Payload(oversizedInvite)).toThrow();
    // The invite is schema-valid; only the encoded payload budget rejects it.
    expect(HomeQrInviteV2Schema.safeParse(oversizedInvite).success).toBe(true);
    const manualPayload = jsonPayload(oversizedInvite as unknown as Record<string, unknown>);
    expect(manualPayload.length).toBeGreaterThan(HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES);
    expect(parseHomeQrInviteV2Payload(manualPayload, { nowMs: NOW_MS })).toBeNull();
  });

  it('validates invites through the schema owner', () => {
    expect(HomeQrInviteV2Schema.safeParse(INVITE_NO_LABEL).success).toBe(true);
    expect(HomeQrInviteV2Schema.safeParse(INVITE_WITH_LABEL).success).toBe(true);
    expect(HomeQrInviteV2Schema.safeParse({ ...INVITE_NO_LABEL, extra: true }).success).toBe(false);
  });
});
