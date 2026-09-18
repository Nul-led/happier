import { z } from 'zod';
import tweetnacl from 'tweetnacl';
import { ProviderBrokerApplicationBindingV1Schema } from '../../../../providers/brokerRouteGrantV1.js';
import { AuthTokenAuthenticationEvidenceSnapshotV1Schema } from '../../../../auth/authToken.js';
import { TeamCredentialSourceBindingV1Schema } from '../../../../teams/credentials/sourceBindingV1.js';

import { decodeBase64 } from '../../../../crypto/base64.js';
import { createCanonicalJsonSigningInput } from '../../../../crypto/canonicalJson.js';
import { verifyEd25519Signature } from '../../../../crypto/ed25519.js';
import { VoiceMediaApplicationKindV1Schema } from '../voiceMediaV1.js';

export const PEER_TCP_TUNNEL_RELAY_AUTHORIZATION_AUDIENCE_V1 =
  'happier-tcp-tunnel-relay-authorization' as const;
export const PEER_TCP_TUNNEL_RELAY_SOCKET_ID_MAX_LENGTH = 256;

const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().nonnegative();

export const PeerTcpTunnelRelayAuthorizationFlowKindV1Schema = z.enum([
  'tcp_tunnel',
  'voice_media',
  'provider_broker',
]);
export type PeerTcpTunnelRelayAuthorizationFlowKindV1 = z.infer<
  typeof PeerTcpTunnelRelayAuthorizationFlowKindV1Schema
>;

export const PeerTcpTunnelRelayAuthorizationDestinationV1Schema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
});
export type PeerTcpTunnelRelayAuthorizationDestinationV1 = z.infer<
  typeof PeerTcpTunnelRelayAuthorizationDestinationV1Schema
>;

export const ProviderBrokerExternalApiKeyRelayBindingV1Schema = z.object({
  v: z.literal(1),
  kind: z.literal('external_api_key'),
  teamId: z.string().min(1),
  resourceId: z.string().min(1),
  requestId: z.string().min(1),
  externalApiKeyId: z.string().uuid(),
  assignedAccountId: z.string().min(1),
  assignedTeamMembershipId: z.string().min(1),
}).strict();
export const ProviderBrokerResourceTestRelayBindingV1Schema = z.object({
  v: z.literal(1),
  kind: z.literal('resource_test'),
  teamId: z.string().min(1),
  resourceId: z.string().min(1),
  requestId: z.string().min(1),
  actorAccountId: z.string().min(1),
  expectedResourceRevision: z.number().int().positive(),
  application: ProviderBrokerApplicationBindingV1Schema,
  source: TeamCredentialSourceBindingV1Schema,
  verifiedCredentialEvidence: AuthTokenAuthenticationEvidenceSnapshotV1Schema.optional(),
}).strict();
export type ProviderBrokerResourceTestRelayBindingV1 = z.infer<
  typeof ProviderBrokerResourceTestRelayBindingV1Schema
>;
export const ProviderBrokerRelayApplicationBindingV1Schema = z.discriminatedUnion('kind', [
  ProviderBrokerExternalApiKeyRelayBindingV1Schema,
  ProviderBrokerResourceTestRelayBindingV1Schema,
]);
export type ProviderBrokerRelayApplicationBindingV1 = z.infer<
  typeof ProviderBrokerRelayApplicationBindingV1Schema
>;

export const PeerTcpTunnelRelayAuthorizationSignatureV1Schema = z.object({
  keyId: z.string().min(1),
  alg: z.literal('Ed25519'),
  valueBase64Url: Base64UrlSchema,
});
export type PeerTcpTunnelRelayAuthorizationSignatureV1 = z.infer<
  typeof PeerTcpTunnelRelayAuthorizationSignatureV1Schema
>;

/**
 * Socket-lifetime-bound relay authorization. V2 is intentionally strict: the
 * source relay socket id is an admission identity, not an extensible metadata
 * bag, and every verifier signs/parses the same exact field set.
 */
export const PeerTcpTunnelRelayAuthorizationPayloadV2Schema = z
  .object({
    v: z.literal(2),
    grantId: z.string().min(1),
    accountId: z.string().min(1),
    targetMachineId: z.string().min(1),
    flowKind: PeerTcpTunnelRelayAuthorizationFlowKindV1Schema,
    routeKind: z.literal('server_relay'),
    tunnelId: z.string().min(1),
    applicationKind: VoiceMediaApplicationKindV1Schema.optional(),
    applicationAttemptId: z.string().min(1).max(256).optional(),
    applicationAuthorityDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u).optional(),
    relaySocketId: z.string().min(1).max(PEER_TCP_TUNNEL_RELAY_SOCKET_ID_MAX_LENGTH),
    destination: PeerTcpTunnelRelayAuthorizationDestinationV1Schema.strict().optional(),
    providerBroker: ProviderBrokerRelayApplicationBindingV1Schema.optional(),
    capProfileId: z.string().min(1),
    maxFrameBytes: PositiveIntSchema,
    maxIdleMs: PositiveIntSchema,
    maxDurationMs: PositiveIntSchema,
    maxTotalBytes: PositiveIntSchema.optional(),
    iat: NonNegativeIntSchema,
    exp: PositiveIntSchema,
    aud: z.literal(PEER_TCP_TUNNEL_RELAY_AUTHORIZATION_AUDIENCE_V1),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.exp <= payload.iat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exp'],
        message: 'TCP tunnel relay authorization must expire after issuance',
      });
    }
    const applicationFields = [
      payload.applicationKind,
      payload.applicationAttemptId,
      payload.applicationAuthorityDigest,
    ];
    if (payload.flowKind === 'voice_media' && applicationFields.some((value) => value === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applicationKind'],
        message: 'Voice media relay authorization requires exact application authority',
      });
    }
    if (payload.flowKind === 'tcp_tunnel' && applicationFields.some((value) => value !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applicationKind'],
        message: 'TCP tunnel relay authorization cannot carry Voice application authority',
      });
    }
    if (payload.flowKind === 'provider_broker') {
      if (payload.destination !== undefined || payload.providerBroker === undefined
        || applicationFields.some((value) => value !== undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providerBroker'],
          message: 'Provider broker relay authorization requires only an exact application binding',
        });
      }
    } else if (payload.destination === undefined || payload.providerBroker !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination'],
        message: 'TCP and Voice relay authorization require only a loopback destination',
      });
    }
  });
export type PeerTcpTunnelRelayAuthorizationPayloadV2 = z.infer<
  typeof PeerTcpTunnelRelayAuthorizationPayloadV2Schema
>;

export const PeerTcpTunnelRelayAuthorizationV2Schema = z
  .object({
    payload: PeerTcpTunnelRelayAuthorizationPayloadV2Schema,
    signature: PeerTcpTunnelRelayAuthorizationSignatureV1Schema.strict(),
  })
  .strict();
export type PeerTcpTunnelRelayAuthorizationV2 = z.infer<typeof PeerTcpTunnelRelayAuthorizationV2Schema>;

/**
 * The relay authorization accepted on the wire. V1 was removed in the RU2 surfaces
 * finalization: nothing ever minted it (the only minter emits `v: 2`) and both verifiers
 * call `verifyPeerTcpTunnelRelayAuthorizationV2`, whose payload is `.strict()` on
 * `v: 2` — so a V1 object parsed here only to be rejected at verification. Keeping it
 * widened the accepted wire surface with a `.passthrough()` shape that could never succeed.
 */
export const PeerTcpTunnelRelayAuthorizationSchema = PeerTcpTunnelRelayAuthorizationV2Schema;
export type PeerTcpTunnelRelayAuthorization = z.infer<typeof PeerTcpTunnelRelayAuthorizationSchema>;

export type PeerTcpTunnelRelayAuthorizationTrustRootV1 = Readonly<{
  keyId: string;
  publicKeyBase64Url: string;
  expiresAt?: number | null;
}>;

export type VerifyPeerTcpTunnelRelayAuthorizationV2Result =
  | Readonly<{ valid: true; payload: PeerTcpTunnelRelayAuthorizationPayloadV2 }>
  | Readonly<{
      valid: false;
      reasonCode:
        | 'authorization_invalid'
        | 'authorization_expired'
        | 'authorization_not_yet_valid'
        | 'unknown_key'
        | 'invalid_public_key'
        | 'invalid_signature'
        | 'bad_signature';
    }>;

export function createPeerTcpTunnelRelayAuthorizationSigningInputV2(
  payload: PeerTcpTunnelRelayAuthorizationPayloadV2,
): string {
  return createCanonicalJsonSigningInput(PeerTcpTunnelRelayAuthorizationPayloadV2Schema.parse(payload));
}

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
