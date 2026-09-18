import { z } from 'zod';

import { decodeBase64, encodeBase64 } from '../../crypto/base64.js';
import { ProviderPublicHeadersV1Schema } from '../../providers/publicHeadersSchema.js';
import { PROVIDER_ENDPOINT_SAFETY_LIMITS } from '../../providers/safety/limits.js';
import { ProviderBrokerApplicationBindingV1Schema, ProviderBrokerRequestFactsV1Schema } from '../../providers/brokerRouteGrantV1.js';
import {
  ProviderBrokerExternalApiKeyRelayBindingV1Schema,
  ProviderBrokerResourceTestRelayBindingV1Schema,
  PeerTcpTunnelRelayAuthorizationV2Schema,
} from '../../machines/peer/mediation/tunnel/authorization.js';
import { TeamCredentialSourceBindingV1Schema } from './sourceBindingV1.js';
import { TeamCredentialUsageLimitDenialV1Schema } from './usageV1.js';

/** Stable public base URL used by compatible OpenAI and Anthropic clients. */
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_API_BASE_PATH_V1 = '/api/provider-broker/v1' as const;
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_ADMISSION_HTTP_PATH_V1 = '/v1/teams/credential-resources/broker/external/admit' as const;
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_TERMINAL_USAGE_HTTP_PATH_V1 = '/v1/teams/credential-resources/broker/external/terminal-usage' as const;
export const TEAM_CREDENTIAL_RESOURCE_TEST_ADMISSION_HTTP_PATH_V1 = '/v1/teams/credential-resources/broker/resource-test/admit' as const;
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_APPLICATION_HTTP_PATH_V1 = '/__happier/provider-broker/external/v1' as const;
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_RAW_BODY_MAX_BYTES_V1 =
  PROVIDER_ENDPOINT_SAFETY_LIMITS.maxDecodedBodyBytes;
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_BODY_BASE64_MAX_CHARS_V1 =
  Math.ceil(TEAM_CREDENTIAL_EXTERNAL_PROVIDER_RAW_BODY_MAX_BYTES_V1 / 3) * 4;
/** Canonical Provider request metadata/header reserve above the maximally
 * encoded body. The boundary is derived from the shared Provider safety
 * catalog rather than a public-ingress-only byte ceiling. */
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_APPLICATION_ENVELOPE_MAX_BYTES_V1 =
  TEAM_CREDENTIAL_EXTERNAL_PROVIDER_BODY_BASE64_MAX_CHARS_V1
  + PROVIDER_ENDPOINT_SAFETY_LIMITS.maxUrlChars
  + PROVIDER_ENDPOINT_SAFETY_LIMITS.maxPublicHeaders * (
    PROVIDER_ENDPOINT_SAFETY_LIMITS.maxHeaderNameChars
    + PROVIDER_ENDPOINT_SAFETY_LIMITS.maxHeaderValueChars
    + 8
  );

export const TeamCredentialExternalProviderRouteV1Schema = z.enum([
  'models',
  'chat_completions',
  'responses',
  'messages',
  'messages_count_tokens',
]);
export type TeamCredentialExternalProviderRouteV1 = z.infer<typeof TeamCredentialExternalProviderRouteV1Schema>;

const ExternalProviderIdentityV1Schema = z.string().min(1);
const ExternalProviderApiKeyIdV1Schema = z.string().uuid();

export const TeamCredentialExternalProviderRequestHeadersV1Schema = ProviderPublicHeadersV1Schema.superRefine((headers, context) => {
  if (Object.keys(headers).some((name) => (
    name.startsWith('x-happier-')
    || name === 'cookie'
    || name === 'set-cookie'
    || name === 'proxy-authorization'
    || name === 'forwarded'
    || name.startsWith('x-forwarded-')
  ))) {
    context.addIssue({ code: 'custom', message: 'Caller authentication or forwarding headers cannot cross the external Provider boundary.' });
  }
});

export const TeamCredentialExternalProviderCallerV1Schema = z.object({
  kind: z.literal('external_api_key'),
  keyId: ExternalProviderApiKeyIdV1Schema,
  assignedAccountId: ExternalProviderIdentityV1Schema,
  assignedTeamMembershipId: ExternalProviderIdentityV1Schema,
}).strict();
export type TeamCredentialExternalProviderCallerV1 = z.infer<typeof TeamCredentialExternalProviderCallerV1Schema>;

const CanonicalRequestBodyBase64V1Schema = z.string().min(1)
  .max(TEAM_CREDENTIAL_EXTERNAL_PROVIDER_BODY_BASE64_MAX_CHARS_V1).refine((value) => {
  try {
    return encodeBase64(decodeBase64(value, 'base64'), 'base64') === value;
  } catch {
    return false;
  }
}, 'Request body must be canonical base64.');

export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_HTTP_ROUTES_V1 = Object.freeze({
  models: { method: 'GET', publicPath: '/models', providerPath: '/v1/models', inference: false },
  chat_completions: { method: 'POST', publicPath: '/chat/completions', providerPath: '/v1/chat/completions', inference: true },
  responses: { method: 'POST', publicPath: '/responses', providerPath: '/v1/responses', inference: true },
  messages: { method: 'POST', publicPath: '/messages', providerPath: '/v1/messages', inference: true },
  messages_count_tokens: { method: 'POST', publicPath: '/messages/count_tokens', providerPath: '/v1/messages/count_tokens', inference: false },
} as const satisfies Readonly<Record<
  TeamCredentialExternalProviderRouteV1,
  Readonly<{ method: 'GET' | 'POST'; publicPath: string; providerPath: string; inference: boolean }>
>>);

/** Exact request-policy protocol families exposed by the public ingress. */
export const TEAM_CREDENTIAL_EXTERNAL_PROVIDER_PROTOCOLS_V1 = Object.freeze([
  'openai_responses',
  'openai_chat_completions',
  'anthropic_messages',
] as const);

/**
 * Strict Home-edge to broker-application DTO. Machine selection and local
 * managed-service authority remain exclusively owned by the existing signed
 * broker grant and carrier.
 */
export const TeamCredentialExternalProviderApplicationRequestV1Schema = z.object({
  v: z.literal(1),
  requestId: ExternalProviderIdentityV1Schema,
  teamId: ExternalProviderIdentityV1Schema,
  resourceId: ExternalProviderIdentityV1Schema,
  caller: TeamCredentialExternalProviderCallerV1Schema,
  route: TeamCredentialExternalProviderRouteV1Schema,
  method: z.enum(['GET', 'POST']),
  pathAndQuery: z.string().min(1),
  headers: TeamCredentialExternalProviderRequestHeadersV1Schema.optional(),
  bodyBase64: CanonicalRequestBodyBase64V1Schema.nullable(),
}).strict().superRefine((request, context) => {
  const descriptor = TEAM_CREDENTIAL_EXTERNAL_PROVIDER_HTTP_ROUTES_V1[request.route];
  if (request.method !== descriptor.method) {
    context.addIssue({ code: 'custom', path: ['method'], message: 'Method does not match the selected Provider route.' });
  }
  if (request.pathAndQuery !== descriptor.providerPath) {
    context.addIssue({ code: 'custom', path: ['pathAndQuery'], message: 'Path does not match the selected Provider route.' });
  }
  if ((request.method === 'GET') !== (request.bodyBase64 === null)) {
    context.addIssue({ code: 'custom', path: ['bodyBase64'], message: 'GET is bodyless and Provider POST routes require a body.' });
  }
});
export type TeamCredentialExternalProviderApplicationRequestV1 = z.infer<
  typeof TeamCredentialExternalProviderApplicationRequestV1Schema
>;

export const TeamCredentialResourceTestApplicationRequestV1Schema = z.object({
  v: z.literal(1),
  kind: z.literal('resource_test'),
  requestId: ExternalProviderIdentityV1Schema,
  teamId: ExternalProviderIdentityV1Schema,
  resourceId: ExternalProviderIdentityV1Schema,
  route: TeamCredentialExternalProviderRouteV1Schema.exclude(['models']),
  method: z.literal('POST'),
  pathAndQuery: z.string().min(1),
  headers: TeamCredentialExternalProviderRequestHeadersV1Schema.optional(),
  bodyBase64: CanonicalRequestBodyBase64V1Schema,
}).strict().superRefine((request, context) => {
  const descriptor = TEAM_CREDENTIAL_EXTERNAL_PROVIDER_HTTP_ROUTES_V1[request.route];
  if (request.pathAndQuery !== descriptor.providerPath) {
    context.addIssue({ code: 'custom', path: ['pathAndQuery'], message: 'Path does not match the selected Provider route.' });
  }
});
export type TeamCredentialResourceTestApplicationRequestV1 = z.infer<typeof TeamCredentialResourceTestApplicationRequestV1Schema>;

export const TeamCredentialProviderBrokerApplicationCarrierRequestV1Schema = z.union([
  TeamCredentialExternalProviderApplicationRequestV1Schema,
  TeamCredentialResourceTestApplicationRequestV1Schema,
]);
export type TeamCredentialProviderBrokerApplicationCarrierRequestV1 = z.infer<typeof TeamCredentialProviderBrokerApplicationCarrierRequestV1Schema>;

/** Broker-Machine to Home currentness and usage admission. The authenticated
 * broker Account is transport authority and is intentionally absent here. */
export const TeamCredentialExternalProviderAdmissionV1Schema = z.object({
  v: z.literal(1),
  binding: ProviderBrokerExternalApiKeyRelayBindingV1Schema,
  brokerMachineId: ExternalProviderIdentityV1Schema,
  expectedResourceRevision: z.number().int().nonnegative(),
  application: ProviderBrokerApplicationBindingV1Schema,
  requestFacts: ProviderBrokerRequestFactsV1Schema,
}).strict();

/** Metadata-only external-key authorization. It deliberately carries no
 * inference facts, source binding, UsageEvent identity, or Provider access. */
export const TeamCredentialExternalProviderModelCatalogAuthorizationV1Schema = z.object({
  v: z.literal(1),
  binding: ProviderBrokerExternalApiKeyRelayBindingV1Schema,
  brokerMachineId: ExternalProviderIdentityV1Schema,
  expectedResourceRevision: z.number().int().nonnegative(),
  application: ProviderBrokerApplicationBindingV1Schema,
}).strict();
export type TeamCredentialExternalProviderModelCatalogAuthorizationV1 = z.infer<
  typeof TeamCredentialExternalProviderModelCatalogAuthorizationV1Schema
>;

export const TeamCredentialExternalProviderAdmissionResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    resourceId: ExternalProviderIdentityV1Schema,
    resourceRevision: z.number().int().nonnegative(),
    brokerMachineId: ExternalProviderIdentityV1Schema,
    source: TeamCredentialSourceBindingV1Schema,
    operation: z.object({
      kind: z.literal('external_api_key'),
      externalApiKeyId: ExternalProviderApiKeyIdV1Schema,
      assignedAccountId: ExternalProviderIdentityV1Schema,
      assignedTeamMembershipId: ExternalProviderIdentityV1Schema,
    }).strict(),
    usageEventId: ExternalProviderIdentityV1Schema.nullable(),
    terminalRequestId: ExternalProviderIdentityV1Schema.nullable(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    reasonCode: z.enum([
      'invalid_request', 'resource_forbidden', 'resource_unavailable', 'resource_changed',
      'operation_not_current', 'broker_unavailable', 'team_credential_usage_limit',
      'token_limit_unavailable', 'cost_limit_unavailable', 'duplicate_request',
    ]),
    usageLimit: TeamCredentialUsageLimitDenialV1Schema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.usageLimit && value.reasonCode !== 'team_credential_usage_limit') {
      context.addIssue({ code: 'custom', path: ['usageLimit'], message: 'usageLimit requires an exhausted Team credential limit' });
    }
  }),
]);
export type TeamCredentialExternalProviderAdmissionV1 = z.infer<typeof TeamCredentialExternalProviderAdmissionV1Schema>;
export type TeamCredentialExternalProviderAdmissionResponseV1 = z.infer<typeof TeamCredentialExternalProviderAdmissionResponseV1Schema>;

/** The current managed response exposes terminal lifecycle, but no bounded
 * authoritative token/cost observer. This strict internal report therefore
 * records only the real terminal fact and keeps metric coverage unavailable. */
export const TeamCredentialExternalProviderTerminalUsageV1Schema = z.object({
  v: z.literal(1),
  admissionUsageEventId: ExternalProviderIdentityV1Schema,
  requestId: ExternalProviderIdentityV1Schema,
  brokerMachineId: ExternalProviderIdentityV1Schema,
  completedAtMs: z.number().int().nonnegative().safe(),
  outcome: z.enum(['succeeded', 'failed', 'cancelled']),
  measurement: z.literal('unavailable'),
}).strict();
export type TeamCredentialExternalProviderTerminalUsageV1 = z.infer<
  typeof TeamCredentialExternalProviderTerminalUsageV1Schema
>;

export const TeamCredentialExternalProviderTerminalUsageResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), usageEventId: ExternalProviderIdentityV1Schema, created: z.boolean() }).strict(),
  z.object({ ok: z.literal(false), reasonCode: z.enum(['invalid_request', 'terminal_usage_mismatch']) }).strict(),
]);
export type TeamCredentialExternalProviderTerminalUsageResponseV1 = z.infer<
  typeof TeamCredentialExternalProviderTerminalUsageResponseV1Schema
>;

/** Exact broker-Machine to Home admission for the user-invoked resource test.
 * Home re-verifies the complete relay authorization and compares this strict
 * inner binding before disclosure or usage; no external key or Session is
 * fabricated for this effect. */
export const TeamCredentialResourceTestAdmissionV1Schema = z.object({
  v: z.literal(1),
  binding: ProviderBrokerResourceTestRelayBindingV1Schema,
  brokerMachineId: ExternalProviderIdentityV1Schema,
  relayAuthorization: PeerTcpTunnelRelayAuthorizationV2Schema,
  requestFacts: ProviderBrokerRequestFactsV1Schema,
}).strict();

export const TeamCredentialResourceTestAdmissionResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    resourceId: ExternalProviderIdentityV1Schema,
    resourceRevision: z.number().int().positive(),
    brokerMachineId: ExternalProviderIdentityV1Schema,
    source: TeamCredentialSourceBindingV1Schema,
    operation: z.object({
      kind: z.literal('resource_test'),
      actorAccountId: ExternalProviderIdentityV1Schema,
    }).strict(),
    usageEventId: ExternalProviderIdentityV1Schema.nullable(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    reasonCode: z.enum([
      'invalid_request', 'resource_forbidden', 'resource_unavailable', 'resource_changed',
      'operation_not_current', 'broker_unavailable', 'team_credential_usage_limit',
      'token_limit_unavailable', 'cost_limit_unavailable', 'duplicate_request',
    ]),
    usageLimit: TeamCredentialUsageLimitDenialV1Schema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.usageLimit && value.reasonCode !== 'team_credential_usage_limit') {
      context.addIssue({ code: 'custom', path: ['usageLimit'], message: 'usageLimit requires an exhausted Team credential limit' });
    }
  }),
]);
export type TeamCredentialResourceTestAdmissionV1 = z.infer<typeof TeamCredentialResourceTestAdmissionV1Schema>;
export type TeamCredentialResourceTestAdmissionResponseV1 = z.infer<typeof TeamCredentialResourceTestAdmissionResponseV1Schema>;

export const TeamCredentialExternalProviderErrorCodeV1Schema = z.enum([
  'invalid_api_key',
  'invalid_request',
  'resource_unavailable',
  'policy_denied',
  'team_credential_usage_limit',
  'cost_limit_unavailable',
  'broker_unavailable',
  'upstream_unavailable',
  'request_cancelled',
]);
export type TeamCredentialExternalProviderErrorCodeV1 = z.infer<typeof TeamCredentialExternalProviderErrorCodeV1Schema>;

export const TeamCredentialExternalProviderErrorV1Schema = z.object({
  error: z.object({
    type: z.literal('happier_provider_broker_error'),
    code: TeamCredentialExternalProviderErrorCodeV1Schema,
    message: z.string().min(1).max(240),
  }).strict(),
}).strict();
export type TeamCredentialExternalProviderErrorV1 = z.infer<typeof TeamCredentialExternalProviderErrorV1Schema>;
