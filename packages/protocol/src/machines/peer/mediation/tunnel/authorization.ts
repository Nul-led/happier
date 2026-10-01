import tweetnacl from 'tweetnacl';
import { decodeBase64 } from '../../../../crypto/base64.js';
import { verifyEd25519Signature } from '../../../../crypto/ed25519.js';
import {
  PeerTcpTunnelRelayAuthorizationV2Schema,
  createPeerTcpTunnelRelayAuthorizationSigningInputV2,
  type PeerTcpTunnelRelayAuthorizationTrustRootV1,
  type VerifyPeerTcpTunnelRelayAuthorizationV2Result,
} from './authorizationSchemas.js';

// Signature verification remains runtime-owned; the wire schemas have one portable owner.
export * from './authorizationSchemas.js';

function decodeBase64UrlStrict(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  try {
    return decodeBase64(value, 'base64url');
  } catch {
    return null;
  }
}

export function verifyPeerTcpTunnelRelayAuthorizationV2(input: Readonly<{
  authorization: unknown;
  nowMs: number;
  trustRoots: readonly PeerTcpTunnelRelayAuthorizationTrustRootV1[];
}>): VerifyPeerTcpTunnelRelayAuthorizationV2Result {
  const parsed = PeerTcpTunnelRelayAuthorizationV2Schema.safeParse(input.authorization);
  if (!parsed.success) return { valid: false, reasonCode: 'authorization_invalid' };

  const authorization = parsed.data;
  if (input.nowMs < authorization.payload.iat) {
    return { valid: false, reasonCode: 'authorization_not_yet_valid' };
  }
  if (input.nowMs >= authorization.payload.exp) {
    return { valid: false, reasonCode: 'authorization_expired' };
  }

  const trustRoot = input.trustRoots.find((candidate) => candidate.keyId === authorization.signature.keyId);
  if (!trustRoot || (trustRoot.expiresAt != null && input.nowMs >= trustRoot.expiresAt)) {
    return { valid: false, reasonCode: 'unknown_key' };
  }

  const publicKey = decodeBase64UrlStrict(trustRoot.publicKeyBase64Url);
  if (!publicKey || publicKey.byteLength !== tweetnacl.sign.publicKeyLength) {
    return { valid: false, reasonCode: 'invalid_public_key' };
  }
  const signature = decodeBase64UrlStrict(authorization.signature.valueBase64Url);
  if (!signature || signature.byteLength !== tweetnacl.sign.signatureLength) {
    return { valid: false, reasonCode: 'invalid_signature' };
  }

  const signingInput = new TextEncoder().encode(
    createPeerTcpTunnelRelayAuthorizationSigningInputV2(authorization.payload),
  );
  return verifyEd25519Signature(signingInput, signature, publicKey)
    ? { valid: true, payload: authorization.payload }
    : { valid: false, reasonCode: 'bad_signature' };
}
