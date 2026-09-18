import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from './base64.js';
import {
  HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS,
  HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES,
  HOME_QR_INVITE_V2_MAX_TTL_MS,
  HOME_QR_SECRET_V2_BYTES,
  HomeQrInviteV2Schema,
  type HomeQrInviteV2,
  computeHomeQrBindingProofV2,
  createHomeQrReverseInviteV2,
  createHomeQrBindingInputV2,
  deriveHomeQrBindingKeyV2,
  deriveHomeQrRendezvousSecretV2,
  deriveHomeQrRendezvousVerifierV2,
  encodeHomeQrInviteV2Payload,
  parseHomeQrInviteV2Payload,
  parseHomeQrPairingStatusV2,
  verifyHomeQrBindingProofV2,
  verifyHomeQrRequesterProofV2,
  verifyHomeQrRendezvousSecretV2,
  verifyHomeQrRendezvousVerifierV2,
} from './qrProvisioningV2.js';

// Fixed golden fixtures. Every expected byte string below was computed with an
// independent HMAC-SHA-256/SHA-256/canonical-JSON implementation (Node crypto
// and Buffer base64url) over these exact inputs; none are derived through the
// functions under test.
const GOLDEN = {
  qrSecretBase64Url: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
  requesterPublicKeyHex: '0808080808080808080808080808080808080808080808080808080808080808',
  requesterPublicKeyBase64Url: 'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg',
  // Same 32 decoded bytes as the canonical encoding, non-canonical final symbol.
  requesterPublicKeyNonCanonicalBase64Url: 'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAh',
  rendezvousSecretHex: 'dbd6b46487a573a1503b9e8f78276affbff593eb8a59fdfb951d485632b0bdcd',
  bindingKeyHex: 'b3909cede7dedd5a049d93565f9fd1ea8420fefd06e9c1bafe7e7ed3cc2b099c',
  bindingInputHex:
    '0000000276320000000b686f6d655f64657669636500000015747275737465645f686f6d655f646973706c61797300000006706169722d31000000087372765f686f6d650000002008080808080808080808080808080808080808080808080808080808080808080000000432303030',
  bindingProofBase64Url: 'Zk-z42UJNUN9nlBi67QxyYywsYnV2f6eQVvrZZuVWD8',
  bindingInputReverseHex:
    '0000000276320000000b686f6d655f646576696365000000127265717565737465725f646973706c61797300000006706169722d31000000087372765f686f6d650000002008080808080808080808080808080808080808080808080808080808080808080000000432303030',
  bindingProofReverseBase64Url: 'nqBbeNiB0vCPAgOqtVX8cOcOXbU0nt1jeuZ_0KgA5u0',
  rendezvousVerifierHex: '7564512c23402e8ad27d0b19a06264fbc9095273b1bc5824395cb9736a3b1349',
  invitePayloadForward:
    'eyJkaXJlY3Rpb24iOiJ0cnVzdGVkX2hvbWVfZGlzcGxheXMiLCJleHBpcmVzQXRNcyI6NjEwMDAsImhvbWUiOnsiY2Fub25pY2FsU2VydmVyVXJsIjoiaHR0cHM6Ly9ob21lLmV4YW1wbGUiLCJlbmRwb2ludHMiOlt7ImtpbmQiOiJodHRwcyIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dLCJob21lU2VydmVySWRlbnRpdHlJZCI6InNydl9ob21lIiwicmV2aXNpb24iOjEsInYiOjF9LCJpbnRlbnQiOiJob21lX2RldmljZSIsImlzc3VlZEF0TXMiOjEwMDAsInBhaXJJZCI6InBhaXItMSIsInFyU2VjcmV0QmFzZTY0VXJsIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsInYiOjJ9',
  invitePayloadForwardWithLabel:
    'eyJkaXJlY3Rpb24iOiJ0cnVzdGVkX2hvbWVfZGlzcGxheXMiLCJleHBpcmVzQXRNcyI6NjEwMDAsImhvbWUiOnsiY2Fub25pY2FsU2VydmVyVXJsIjoiaHR0cHM6Ly9ob21lLmV4YW1wbGUiLCJlbmRwb2ludHMiOlt7ImtpbmQiOiJodHRwcyIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dLCJob21lU2VydmVySWRlbnRpdHlJZCI6InNydl9ob21lIiwicmV2aXNpb24iOjEsInYiOjF9LCJpbnRlbnQiOiJob21lX2RldmljZSIsImlzc3VlZEF0TXMiOjEwMDAsInBhaXJJZCI6InBhaXItMSIsInFyU2VjcmV0QmFzZTY0VXJsIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsInJlcXVlc3RlZERldmljZUxhYmVsIjoiRGVzayBwaG9uZSIsInYiOjJ9',
  invitePayloadReverseNoLabel:
    'eyJkaXJlY3Rpb24iOiJyZXF1ZXN0ZXJfZGlzcGxheXMiLCJleHBpcmVzQXRNcyI6NjEwMDAsImhvbWUiOnsiY2Fub25pY2FsU2VydmVyVXJsIjoiaHR0cHM6Ly9ob21lLmV4YW1wbGUiLCJlbmRwb2ludHMiOlt7ImtpbmQiOiJodHRwcyIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dLCJob21lU2VydmVySWRlbnRpdHlJZCI6InNydl9ob21lIiwicmV2aXNpb24iOjEsInYiOjF9LCJpbnRlbnQiOiJob21lX2RldmljZSIsImlzc3VlZEF0TXMiOjEwMDAsInBhaXJJZCI6InBhaXItMSIsInFyU2VjcmV0QmFzZTY0VXJsIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsInJlcXVlc3RlclB1YmxpY0tleUJhc2U2NFVybCI6IkNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWciLCJ2IjoyfQ',
  invitePayloadReverseWithLabel:
    'eyJkaXJlY3Rpb24iOiJyZXF1ZXN0ZXJfZGlzcGxheXMiLCJleHBpcmVzQXRNcyI6NjEwMDAsImhvbWUiOnsiY2Fub25pY2FsU2VydmVyVXJsIjoiaHR0cHM6Ly9ob21lLmV4YW1wbGUiLCJlbmRwb2ludHMiOlt7ImtpbmQiOiJodHRwcyIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dLCJob21lU2VydmVySWRlbnRpdHlJZCI6InNydl9ob21lIiwicmV2aXNpb24iOjEsInYiOjF9LCJpbnRlbnQiOiJob21lX2RldmljZSIsImlzc3VlZEF0TXMiOjEwMDAsInBhaXJJZCI6InBhaXItMSIsInFyU2VjcmV0QmFzZTY0VXJsIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsInJlcXVlc3RlZERldmljZUxhYmVsIjoiRGVzayBwaG9uZSIsInJlcXVlc3RlclB1YmxpY0tleUJhc2U2NFVybCI6IkNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWciLCJ2IjoyfQ',
} as const;

const QR_SECRET = new Uint8Array(32).fill(7);
const REQUESTER_PUBLIC_KEY = new Uint8Array(32).fill(8);

const BINDING_CONTEXT = {
  pairId: 'pair-1',
  homeServerIdentityId: 'srv_home',
  requesterPublicKey: REQUESTER_PUBLIC_KEY,
  expiresAtMs: 2_000,
  direction: 'trusted_home_displays',
} as const;

const BINDING_PARAMS = { qrSecret: QR_SECRET, ...BINDING_CONTEXT } as const;

const REVERSE_BINDING_PARAMS = { ...BINDING_PARAMS, direction: 'requester_displays' } as const;

const HOME = {
  v: 1,
  homeServerIdentityId: 'srv_home',
  canonicalServerUrl: 'https://home.example',
  revision: 1,
  endpoints: [{ kind: 'https', url: 'https://home.example' }],
} as const;

const INVITE_FORWARD: HomeQrInviteV2 = {
  v: 2,
  intent: 'home_device',
  direction: 'trusted_home_displays',
  pairId: 'pair-1',
  home: HOME,
  qrSecretBase64Url: GOLDEN.qrSecretBase64Url,
  issuedAtMs: 1_000,
  expiresAtMs: 61_000,
};

const INVITE_REVERSE_NO_LABEL: HomeQrInviteV2 = {
  v: 2,
  intent: 'home_device',
  direction: 'requester_displays',
  pairId: 'pair-1',
  home: HOME,
  qrSecretBase64Url: GOLDEN.qrSecretBase64Url,
  requesterPublicKeyBase64Url: GOLDEN.requesterPublicKeyBase64Url,
  issuedAtMs: 1_000,
  expiresAtMs: 61_000,
};

const INVITE_FORWARD_WITH_LABEL: HomeQrInviteV2 = {
  ...INVITE_FORWARD,
  requestedDeviceLabel: 'Desk phone',
};

const INVITE_REVERSE_WITH_LABEL: HomeQrInviteV2 = {
  ...INVITE_REVERSE_NO_LABEL,
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

  it('builds the canonical length-delimited binding input for each required direction', () => {
    expect(bytesToHex(createHomeQrBindingInputV2(BINDING_CONTEXT))).toBe(GOLDEN.bindingInputHex);
    expect(bytesToHex(createHomeQrBindingInputV2({ ...BINDING_CONTEXT, direction: 'requester_displays' }))).toBe(GOLDEN.bindingInputReverseHex);
  });

  it('requires an exactly 32-byte requester public key in the binding input for both directions', () => {
    for (const direction of ['trusted_home_displays', 'requester_displays'] as const) {
      for (const length of [0, 31, 33]) {
        expect(() => createHomeQrBindingInputV2({ ...BINDING_CONTEXT, direction, requesterPublicKey: new Uint8Array(length) })).toThrow();
        expect(() => computeHomeQrBindingProofV2({ ...BINDING_PARAMS, direction, requesterPublicKey: new Uint8Array(length) })).toThrow();
      }
    }
  });

  it('computes the golden binding proof for each direction', () => {
    const proof = computeHomeQrBindingProofV2(BINDING_PARAMS);
    expect(proof).toBe(GOLDEN.bindingProofBase64Url);
    expect(proof).toHaveLength(43);
    expect(computeHomeQrBindingProofV2(REVERSE_BINDING_PARAMS)).toBe(GOLDEN.bindingProofReverseBase64Url);
    // The direction is part of the canonical HMAC binding: flipping it can
    // never verify against the other direction's proof.
    expect(GOLDEN.bindingProofBase64Url).not.toBe(GOLDEN.bindingProofReverseBase64Url);
    expect(verifyHomeQrBindingProofV2(REVERSE_BINDING_PARAMS, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2(BINDING_PARAMS, GOLDEN.bindingProofReverseBase64Url)).toBe(false);
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
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, direction: 'requester_displays' }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, homeServerIdentityId: 'srv_other' }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, requesterPublicKey: new Uint8Array(32).fill(9) }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, expiresAtMs: 2_001 }, GOLDEN.bindingProofBase64Url)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...BINDING_PARAMS, qrSecret: new Uint8Array(32).fill(9) }, GOLDEN.bindingProofBase64Url)).toBe(false);
  });

  it('produces a different proof for each changed bound input', () => {
    const golden = computeHomeQrBindingProofV2(BINDING_PARAMS);
    expect(computeHomeQrBindingProofV2({ ...BINDING_PARAMS, pairId: 'pair-2' })).not.toBe(golden);
    expect(computeHomeQrBindingProofV2({ ...BINDING_PARAMS, direction: 'requester_displays' })).not.toBe(golden);
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

describe('Home QR v2 pairing status and requester proof', () => {
  const expiresAt = new Date(BINDING_CONTEXT.expiresAtMs).toISOString();
  const requestedStatus = {
    state: 'requested' as const,
    pairId: BINDING_CONTEXT.pairId,
    expiresAt,
    requestedPublicKey: encodeBase64(REQUESTER_PUBLIC_KEY),
    requestedDeviceLabel: 'Phone',
    bindingProof: GOLDEN.bindingProofBase64Url,
    homeServerIdentityId: BINDING_CONTEXT.homeServerIdentityId,
  };

  it('parses only the exact pairing status wire shape with canonical encodings', () => {
    expect(parseHomeQrPairingStatusV2({ state: 'pending', pairId: BINDING_CONTEXT.pairId, expiresAt }))
      .toEqual({ state: 'pending', pairId: BINDING_CONTEXT.pairId, expiresAt });
    expect(parseHomeQrPairingStatusV2(requestedStatus)).toEqual(requestedStatus);

    const nonCanonicalKey = requestedStatus.requestedPublicKey.replace(/={1,2}$/u, '');
    expect(nonCanonicalKey).not.toBe(requestedStatus.requestedPublicKey);
    expect(parseHomeQrPairingStatusV2({ ...requestedStatus, requestedPublicKey: nonCanonicalKey })).toBeNull();
    expect(parseHomeQrPairingStatusV2({ ...requestedStatus, requestedPublicKey: encodeBase64(new Uint8Array(31)) })).toBeNull();
    expect(parseHomeQrPairingStatusV2({ ...requestedStatus, bindingProof: `${requestedStatus.bindingProof}=` })).toBeNull();
    expect(parseHomeQrPairingStatusV2({ ...requestedStatus, expiresAt: '2000' })).toBeNull();
    expect(parseHomeQrPairingStatusV2({ ...requestedStatus, extra: true })).toBeNull();
  });

  it('returns requester bytes only for the exact live identity, key, expiry, and proof', () => {
    const context = { ...BINDING_PARAMS, issuedAtMs: 1_000, nowMs: 1_500 };
    expect(verifyHomeQrRequesterProofV2({ ...context, status: requestedStatus })).toEqual(REQUESTER_PUBLIC_KEY);
    expect(verifyHomeQrRequesterProofV2({ ...context, status: { ...requestedStatus, pairId: 'pair-other' } })).toBeNull();
    expect(verifyHomeQrRequesterProofV2({ ...context, status: { ...requestedStatus, homeServerIdentityId: 'srv_other' } })).toBeNull();
    expect(verifyHomeQrRequesterProofV2({ ...context, status: { ...requestedStatus, bindingProof: GOLDEN.bindingProofReverseBase64Url } })).toBeNull();
    expect(verifyHomeQrRequesterProofV2({ ...context, status: { ...requestedStatus, expiresAt: new Date(2_001).toISOString() } })).toBeNull();
    expect(verifyHomeQrRequesterProofV2({ ...context, nowMs: 999, status: requestedStatus })).toBeNull();
    expect(verifyHomeQrRequesterProofV2({ ...context, nowMs: 2_000, status: requestedStatus })).toBeNull();
    expect(verifyHomeQrRequesterProofV2({
      ...context,
      expectedRequesterPublicKey: new Uint8Array(32).fill(9),
      status: requestedStatus,
    })).toBeNull();
  });
});

describe('Home QR v2 invite payload codec (golden vectors)', () => {
  it('encodes the canonical deterministic payload forms for both directions', () => {
    expect(encodeHomeQrInviteV2Payload(INVITE_FORWARD)).toBe(GOLDEN.invitePayloadForward);
    expect(encodeHomeQrInviteV2Payload(INVITE_FORWARD_WITH_LABEL)).toBe(GOLDEN.invitePayloadForwardWithLabel);
    expect(encodeHomeQrInviteV2Payload(INVITE_REVERSE_NO_LABEL)).toBe(GOLDEN.invitePayloadReverseNoLabel);
    expect(encodeHomeQrInviteV2Payload(INVITE_REVERSE_WITH_LABEL)).toBe(GOLDEN.invitePayloadReverseWithLabel);
  });

  it('round-trips both directions through the opaque bounded payload', () => {
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadForward, { nowMs: NOW_MS })).toEqual(INVITE_FORWARD);
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadForwardWithLabel, { nowMs: NOW_MS })).toEqual(INVITE_FORWARD_WITH_LABEL);
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadReverseNoLabel, { nowMs: NOW_MS })).toEqual(INVITE_REVERSE_NO_LABEL);
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadReverseWithLabel, { nowMs: NOW_MS })).toEqual(INVITE_REVERSE_WITH_LABEL);
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(INVITE_REVERSE_WITH_LABEL), { nowMs: NOW_MS })).toEqual(INVITE_REVERSE_WITH_LABEL);
  });

  it('accepts schema-valid invites at the TTL and skew boundaries in both directions', () => {
    const forwardAtMaxTtl: HomeQrInviteV2 = { ...INVITE_FORWARD, issuedAtMs: 0, expiresAtMs: HOME_QR_INVITE_V2_MAX_TTL_MS };
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(forwardAtMaxTtl), { nowMs: HOME_QR_INVITE_V2_MAX_TTL_MS })).toEqual(forwardAtMaxTtl);

    const reverseAtSkewEdge: HomeQrInviteV2 = {
      ...INVITE_REVERSE_NO_LABEL,
      issuedAtMs: NOW_MS + HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS,
      expiresAtMs: NOW_MS + HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS + 1_000,
    };
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(reverseAtSkewEdge), { nowMs: NOW_MS })).toEqual(reverseAtSkewEdge);
  });
});

describe('Home QR v2 invite strict rejection', () => {
  it('rejects unknown, missing, and out-of-contract fields', () => {
    const base = { ...INVITE_FORWARD };
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

  it('requires the direction discriminator on every invite', () => {
    const { direction: _forwardDirection, ...forwardNoDirection } = INVITE_FORWARD;
    expect(parseHomeQrInviteV2Payload(jsonPayload(forwardNoDirection), { nowMs: NOW_MS })).toBeNull();
    expect(() => encodeHomeQrInviteV2Payload(forwardNoDirection as HomeQrInviteV2)).toThrow();
    const { direction: _reverseDirection, ...reverseNoDirection } = INVITE_REVERSE_NO_LABEL;
    expect(parseHomeQrInviteV2Payload(jsonPayload(reverseNoDirection), { nowMs: NOW_MS })).toBeNull();
    expect(() => encodeHomeQrInviteV2Payload(reverseNoDirection as HomeQrInviteV2)).toThrow();
  });

  it('rejects the reverse-only requester key on forward invites', () => {
    // The requester public key is reverse-only.
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, requesterPublicKeyBase64Url: GOLDEN.requesterPublicKeyBase64Url }), { nowMs: NOW_MS })).toBeNull();
    expect(() => encodeHomeQrInviteV2Payload({ ...INVITE_FORWARD, requesterPublicKeyBase64Url: GOLDEN.requesterPublicKeyBase64Url } as HomeQrInviteV2)).toThrow();
  });

  it('requires the reverse-only requester public key on requester-displayed invites', () => {
    const { requesterPublicKeyBase64Url: _dropped, ...reverseNoKey } = INVITE_REVERSE_NO_LABEL;
    expect(parseHomeQrInviteV2Payload(jsonPayload(reverseNoKey), { nowMs: NOW_MS })).toBeNull();
    expect(() => encodeHomeQrInviteV2Payload(reverseNoKey as HomeQrInviteV2)).toThrow();
  });

  it('requires an exact 32-byte canonical requester public key on requester-displayed invites', () => {
    for (const length of [0, 1, 31, 33, 64]) {
      const key = encodeBase64(new Uint8Array(length), 'base64url');
      expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_NO_LABEL, requesterPublicKeyBase64Url: key }), { nowMs: NOW_MS })).toBeNull();
      expect(() => encodeHomeQrInviteV2Payload({ ...INVITE_REVERSE_NO_LABEL, requesterPublicKeyBase64Url: key } as HomeQrInviteV2)).toThrow();
    }
    // Decodes to the same 32 bytes but is not the canonical encoding.
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_NO_LABEL, requesterPublicKeyBase64Url: GOLDEN.requesterPublicKeyNonCanonicalBase64Url }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_NO_LABEL, requesterPublicKeyBase64Url: 'not-a-key!' }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_NO_LABEL, requesterPublicKeyBase64Url: '' }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_NO_LABEL, requesterPublicKeyBase64Url: 8 }), { nowMs: NOW_MS })).toBeNull();
  });

  it('rejects oversized pair ids and labels', () => {
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, pairId: 'p'.repeat(129) }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, pairId: '' }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_WITH_LABEL, requestedDeviceLabel: 'é'.repeat(65) }), { nowMs: NOW_MS })).toBeNull();
    expect(() => encodeHomeQrInviteV2Payload({ ...INVITE_REVERSE_WITH_LABEL, requestedDeviceLabel: 'é'.repeat(65) })).toThrow();
  });

  it('rejects malformed base64url and non-canonical payloads', () => {
    expect(parseHomeQrInviteV2Payload('not-base64url!', { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(`${GOLDEN.invitePayloadForward}=`, { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(encodeBase64(new TextEncoder().encode('not json'), 'base64url'), { nowMs: NOW_MS })).toBeNull();
    // Schema-valid invite serialized in non-canonical key order must be rejected.
    const nonCanonical = encodeBase64(
      new TextEncoder().encode(JSON.stringify({
        v: INVITE_FORWARD.v,
        intent: INVITE_FORWARD.intent,
        direction: INVITE_FORWARD.direction,
        pairId: INVITE_FORWARD.pairId,
        home: INVITE_FORWARD.home,
        qrSecretBase64Url: INVITE_FORWARD.qrSecretBase64Url,
        issuedAtMs: INVITE_FORWARD.issuedAtMs,
        expiresAtMs: INVITE_FORWARD.expiresAtMs,
      })),
      'base64url',
    );
    expect(nonCanonical).not.toBe(GOLDEN.invitePayloadForward);
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
      expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, home }), { nowMs: NOW_MS })).toBeNull();
      expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_NO_LABEL, home }), { nowMs: NOW_MS })).toBeNull();
    }
  });

  it('rejects QR secrets that are not exactly 32 canonical base64url bytes', () => {
    for (const length of [31, 33]) {
      const secret = encodeBase64(new Uint8Array(length), 'base64url');
      expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, qrSecretBase64Url: secret }), { nowMs: NOW_MS })).toBeNull();
      expect(() => encodeHomeQrInviteV2Payload({ ...INVITE_FORWARD, qrSecretBase64Url: secret })).toThrow();
    }
    // The final base64url character carries padding bits: this variant decodes to
    // the same 32 bytes but is not canonical, and must be rejected.
    const nonCanonicalSecret = `${GOLDEN.qrSecretBase64Url.slice(0, -1)}d`;
    expect(decodeBase64(nonCanonicalSecret, 'base64url')).toEqual(decodeBase64(GOLDEN.qrSecretBase64Url, 'base64url'));
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, qrSecretBase64Url: nonCanonicalSecret }), { nowMs: NOW_MS })).toBeNull();
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
      const invite = { ...INVITE_FORWARD, ...patch };
      expect(parseHomeQrInviteV2Payload(jsonPayload(invite as HomeQrInviteV2), { nowMs: NOW_MS })).toBeNull();
      expect(() => encodeHomeQrInviteV2Payload(invite as HomeQrInviteV2)).toThrow();
    }
  });

  it('rejects non-fresh invites against the caller-provided time', () => {
    // Expired.
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadForward, { nowMs: 61_001 })).toBeNull();
    // The expiry instant itself remains valid.
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadForward, { nowMs: 61_000 })).toEqual(INVITE_FORWARD);
    // Issued too far in the future.
    const future: HomeQrInviteV2 = { ...INVITE_FORWARD, issuedAtMs: NOW_MS + HOME_QR_INVITE_V2_MAX_FUTURE_ISSUANCE_SKEW_MS + 1 };
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(future), { nowMs: NOW_MS })).toBeNull();
    // Unsafe nowMs fails closed.
    for (const nowMs of [Number.NaN, -1, 1.5, 2 ** 60]) {
      expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadForward, { nowMs })).toBeNull();
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
    const oversizedInvite: HomeQrInviteV2 = { ...INVITE_FORWARD, home: oversizedHome };
    expect(() => encodeHomeQrInviteV2Payload(oversizedInvite)).toThrow();
    // The invite is schema-valid; only the encoded payload budget rejects it.
    expect(HomeQrInviteV2Schema.safeParse(oversizedInvite).success).toBe(true);
    const manualPayload = jsonPayload(oversizedInvite as unknown as Record<string, unknown>);
    expect(manualPayload.length).toBeGreaterThan(HOME_QR_INVITE_V2_MAX_PAYLOAD_UTF8_BYTES);
    expect(parseHomeQrInviteV2Payload(manualPayload, { nowMs: NOW_MS })).toBeNull();
  });

  it('validates invites through the schema owner', () => {
    expect(HomeQrInviteV2Schema.safeParse(INVITE_FORWARD).success).toBe(true);
    expect(HomeQrInviteV2Schema.safeParse(INVITE_REVERSE_WITH_LABEL).success).toBe(true);
    expect(HomeQrInviteV2Schema.safeParse({ ...INVITE_FORWARD, extra: true }).success).toBe(false);
    expect(HomeQrInviteV2Schema.safeParse({ ...INVITE_FORWARD, requesterPublicKeyBase64Url: GOLDEN.requesterPublicKeyBase64Url }).success).toBe(false);
    expect(HomeQrInviteV2Schema.safeParse(INVITE_FORWARD_WITH_LABEL).success).toBe(true);
    const { direction: _dropped, ...noDirection } = INVITE_FORWARD;
    expect(HomeQrInviteV2Schema.safeParse(noDirection).success).toBe(false);
  });
});

describe('Home QR v2 invite direction discriminator', () => {
  it('accepts both strict direction literals and rejects unknown values', () => {
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadForward, { nowMs: NOW_MS })).toEqual(INVITE_FORWARD);
    expect(parseHomeQrInviteV2Payload(GOLDEN.invitePayloadReverseNoLabel, { nowMs: NOW_MS })).toEqual(INVITE_REVERSE_NO_LABEL);
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, direction: 'attacker_displays' }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_FORWARD, direction: 2 }), { nowMs: NOW_MS })).toBeNull();
    expect(parseHomeQrInviteV2Payload(jsonPayload({ ...INVITE_REVERSE_NO_LABEL, direction: 'trusted_home_displays' }), { nowMs: NOW_MS })).toBeNull();
  });

  it('keeps each direction in its own canonical payload form', () => {
    expect(GOLDEN.invitePayloadForward).not.toBe(GOLDEN.invitePayloadReverseNoLabel);
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(INVITE_FORWARD), { nowMs: NOW_MS })).toEqual(INVITE_FORWARD);
    expect(parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(INVITE_REVERSE_WITH_LABEL), { nowMs: NOW_MS })).toEqual(INVITE_REVERSE_WITH_LABEL);
  });
});

describe('Home QR v2 requester-displayed reverse invite material', () => {
  const reverseInput = {
    home: HOME,
    nowMs: NOW_MS,
  } as const;

  it('generates CSPRNG pair-id, QR secret, ephemeral requester keypair, and policy-compatible default expiry', () => {
    const material = createHomeQrReverseInviteV2(reverseInput);
    expect(material.invite.v).toBe(2);
    expect(material.invite.intent).toBe('home_device');
    expect(material.invite.direction).toBe('requester_displays');
    expect(material.invite.home).toEqual(HOME);
    expect(material.invite.issuedAtMs).toBe(NOW_MS);
    expect(material.invite.expiresAtMs).toBe(NOW_MS + 120_000);
    expect(material.invite.pairId.length).toBeGreaterThan(0);
    expect(material.invite.pairId.length).toBeLessThanOrEqual(128);
    expect(material.qrSecret).toHaveLength(HOME_QR_SECRET_V2_BYTES);
    expect(material.requesterPublicKey).toHaveLength(HOME_QR_SECRET_V2_BYTES);
    expect(material.requesterSecretKey).toHaveLength(tweetnacl.box.secretKeyLength);
    // The invite itself carries the canonical requester public key it binds.
    expect(material.invite.requesterPublicKeyBase64Url).toBe(encodeBase64(material.requesterPublicKey, 'base64url'));
    expect(tweetnacl.box.keyPair.fromSecretKey(material.requesterSecretKey).publicKey).toEqual(material.requesterPublicKey);
    expect('requestedDeviceLabel' in material.invite).toBe(false);
    // All CSPRNG material is fresh per call.
    const second = createHomeQrReverseInviteV2(reverseInput);
    expect(second.invite.pairId).not.toBe(material.invite.pairId);
    expect(second.invite.qrSecretBase64Url).not.toBe(material.invite.qrSecretBase64Url);
    expect(second.requesterPublicKey).not.toEqual(material.requesterPublicKey);
    // The produced material is schema-valid and encodes canonically.
    expect(HomeQrInviteV2Schema.safeParse(material.invite).success).toBe(true);
    expect(() => encodeHomeQrInviteV2Payload(material.invite)).not.toThrow();
  });

  it('carries the optional requester-provided device label', () => {
    const labeled = createHomeQrReverseInviteV2({ ...reverseInput, requestedDeviceLabel: 'Desk phone' });
    expect(labeled.invite.direction).toBe('requester_displays');
    expect(labeled.invite.requestedDeviceLabel).toBe('Desk phone');
    expect(HomeQrInviteV2Schema.safeParse(labeled.invite).success).toBe(true);
  });

  it('honors an explicit bounded TTL and rejects unbounded inputs', () => {
    const short = createHomeQrReverseInviteV2({ ...reverseInput, ttlMs: 1_000 });
    expect(short.invite.expiresAtMs).toBe(NOW_MS + 1_000);
    expect(() => createHomeQrReverseInviteV2({ ...reverseInput, ttlMs: 0 })).toThrow();
    expect(() => createHomeQrReverseInviteV2({ ...reverseInput, ttlMs: HOME_QR_INVITE_V2_MAX_TTL_MS + 1 })).toThrow();
    expect(() => createHomeQrReverseInviteV2({ ...reverseInput, ttlMs: 1.5 })).toThrow();
    expect(() => createHomeQrReverseInviteV2({ ...reverseInput, nowMs: -1 })).toThrow();
    expect(() => createHomeQrReverseInviteV2({ ...reverseInput, nowMs: 1.5 })).toThrow();
  });

  it('binds the produced tuple with the requester-displayed direction', () => {
    const material = createHomeQrReverseInviteV2(reverseInput);
    const qrSecret = decodeBase64(material.invite.qrSecretBase64Url, 'base64url');
    expect(Array.from(qrSecret)).toEqual(Array.from(material.qrSecret));
    const requesterPublicKey = decodeBase64(material.invite.requesterPublicKeyBase64Url, 'base64url');
    expect(Array.from(requesterPublicKey)).toEqual(Array.from(material.requesterPublicKey));
    const bindingContext = {
      qrSecret,
      pairId: material.invite.pairId,
      homeServerIdentityId: material.invite.home.homeServerIdentityId,
      requesterPublicKey,
      expiresAtMs: material.invite.expiresAtMs,
      direction: 'requester_displays',
    } as const;
    const proof = computeHomeQrBindingProofV2(bindingContext);
    // The scanner-side verification succeeds only with the invite direction.
    expect(verifyHomeQrBindingProofV2({ ...bindingContext, direction: 'trusted_home_displays' }, proof)).toBe(false);
    expect(verifyHomeQrBindingProofV2({ ...bindingContext, requesterPublicKey: new Uint8Array(32).fill(9) }, proof)).toBe(false);
    expect(verifyHomeQrBindingProofV2(bindingContext, proof)).toBe(true);
  });
});
