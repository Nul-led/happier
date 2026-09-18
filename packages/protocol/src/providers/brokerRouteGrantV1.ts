import { z } from 'zod';

import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import { decodeBase64, encodeBase64 } from '../crypto/base64.js';
import { IrohEndpointIdV1Schema } from '../connectivity/iroh/endpointDescriptorV1.js';
import { DirectRouteGrantSignatureV2Schema } from '../machines/peer/mediation/directRouteGrantV2.js';
import { PluginContributionIdentityV1Schema } from '../plugins/contributionIdentity.js';
import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import { TeamCredentialSourceBindingV1Schema } from '../teams/credentials/sourceBindingV1.js';
import { TeamCredentialUsageLimitDenialV1Schema } from '../teams/credentials/usageV1.js';
import { ProviderWireProtocolSchema } from './capabilities/v1.js';
import { ProviderAgentTargetKeySchema, ProviderLocalIdSchema } from './ids.js';

export const PROVIDER_BROKER_ROUTE_AUDIENCE_V1 = 'happier-provider-broker-route-v1' as const;
export const PROVIDER_BROKER_OPEN_HTTP_PATH_V1 = '/v1/teams/credential-resources/broker/open' as const;
export const PROVIDER_BROKER_REQUEST_ADMISSION_HTTP_PATH_V1 = '/v1/teams/credential-resources/broker/admit' as const;
export const PROVIDER_BROKER_MODEL_CATALOG_AUTHORIZE_HTTP_PATH_V1 = '/v1/teams/credential-resources/broker/models/authorize' as const;
/** Home-owned Runner readiness admission route, with the same `:resourceId`
 * param the route registrar binds. One template so the daemon client and the
 * route registrar cannot drift. */
export const PROVIDER_BROKER_READINESS_AUTHORIZE_HTTP_PATH_V1 = '/v1/teams/credential-resources/:resourceId/broker/readiness/authorize' as const;
/** Native machine.rs bounds HTTP headers at 16 KiB and generates a 32-byte
 * capability encoded as 64 hex characters. Reserve exactly the two mandatory
 * ASCII header lines, not a separate policy quota. Native ingress still owns
 * the total budget including the request line and all other headers.
 */
const BROKER_AUTHORITY_HEADER_OVERHEAD_BYTES =
  'Authorization: Bearer \r\nX-Happier-Machine-Local-Capability: \r\n'.length + 64;
export const PROVIDER_BROKER_AUTHORITY_MAX_ENCODED_BYTES = 16 * 1024 - BROKER_AUTHORITY_HEADER_OVERHEAD_BYTES;

const IdentitySchema = z.string().min(1);
export const ProviderBrokerConsumerV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: IdentitySchema }).strict(),
  z.object({ kind: z.literal('execution_run'), executionRunId: IdentitySchema }).strict(),
]);

/**
 * Exact managed Provider application selected by the Session/Run owner.
 * Credential-resource source identity and purpose bindings remain separate:
 * the target daemon resolves those only from current Home admission.
 */
export const ProviderBrokerApplicationBindingV1Schema = z.object({
  agentTargetKey: ProviderAgentTargetKeySchema,
  implementationIdentity: asProtocolZod(PluginContributionIdentityV1Schema),
  endpointTemplateId: ProviderLocalIdSchema,
  protocol: ProviderWireProtocolSchema,
}).strict();

/** Dedicated, recursively closed machine/1 authority. Mutable request policy is
 * deliberately absent: current Home admission owns it for every Provider call.
 */
export const ProviderBrokerRouteGrantPayloadV1Schema = z.object({
  v: z.literal(1),
  grantId: IdentitySchema,
  aud: z.literal(PROVIDER_BROKER_ROUTE_AUDIENCE_V1),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  teamId: IdentitySchema,
  resourceId: IdentitySchema,
  expectedResourceRevision: z.number().int().nonnegative(),
  modelId: z.string().trim().min(1).max(512),
  sourceRevision: z.string().trim().min(1).max(512),
  initiator: z.object({ accountId: IdentitySchema, machineId: IdentitySchema, endpointId: IrohEndpointIdV1Schema }).strict(),
  target: z.object({ custodianAccountId: IdentitySchema, machineId: IdentitySchema, endpointId: IrohEndpointIdV1Schema }).strict(),
  consumer: ProviderBrokerConsumerV1Schema,
  executionRunOccurrenceId: IdentitySchema.optional(),
  application: ProviderBrokerApplicationBindingV1Schema,
}).strict().superRefine((payload, context) => {
  if (payload.expiresAt <= payload.issuedAt) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must follow issue time' });
  }
  if (payload.initiator.accountId === payload.target.custodianAccountId) {
    context.addIssue({ code: 'custom', path: ['target', 'custodianAccountId'], message: 'Broker Accounts must be distinct' });
  }
  if (payload.initiator.machineId === payload.target.machineId) {
    context.addIssue({ code: 'custom', path: ['target', 'machineId'], message: 'Broker Machines must be distinct' });
  }
  if (payload.initiator.endpointId === payload.target.endpointId) {
    context.addIssue({ code: 'custom', path: ['target', 'endpointId'], message: 'Broker endpoints must be distinct' });
  }
  if ((payload.consumer.kind === 'execution_run') !== (payload.executionRunOccurrenceId !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['executionRunOccurrenceId'],
      message: 'Execution-run grants must bind exactly one current occurrence',
    });
  }
});

export const SignedProviderBrokerRouteGrantV1Schema = z.object({
  payload: ProviderBrokerRouteGrantPayloadV1Schema,
  signature: DirectRouteGrantSignatureV2Schema,
}).strict().superRefine((authority, context) => {
  const bytes = new TextEncoder().encode(createCanonicalJsonSigningInput(authority));
  if (Math.ceil(bytes.byteLength * 8 / 6) > PROVIDER_BROKER_AUTHORITY_MAX_ENCODED_BYTES) {
    context.addIssue({ code: 'custom', message: 'Encoded broker authority exceeds the native HTTP header budget' });
  }
});

export const IrohProviderBrokerHandshakeV1Schema = z.object({
  v: z.literal(1),
  kind: z.literal('provider_broker'),
  authority: SignedProviderBrokerRouteGrantV1Schema,
}).strict();

export const ProviderBrokerOpenRequestV1Schema = z.object({
  v: z.literal(1),
  resourceId: IdentitySchema,
  expectedResourceRevision: z.number().int().nonnegative(),
  modelId: z.string().trim().min(1).max(512),
  sourceRevision: z.string().trim().min(1).max(512),
  initiatorMachineId: IdentitySchema,
  consumer: ProviderBrokerConsumerV1Schema,
  application: ProviderBrokerApplicationBindingV1Schema,
  /** A previously Home-signed open may be presented only to reauthorize its
   * exact target for another carrier handshake. The Home verifies and
   * revalidates every current resource/source/Machine fact before re-signing. */
  refreshAuthority: SignedProviderBrokerRouteGrantV1Schema.optional(),
}).strict();

export const ProviderBrokerRequestFactsV1Schema = z.object({
  generation: z.boolean(),
  routeKind: z.enum([
    'openai_responses',
    'openai_chat_completions',
    'anthropic_messages',
  ]),
  modelId: z.string(),
  reasoningEffort: z.string().nullable(),
}).strict();

export const ProviderBrokerRequestAdmissionV1Schema = z.object({
  v: z.literal(1),
  authority: SignedProviderBrokerRouteGrantV1Schema,
  expectedResourceRevision: z.number().int().nonnegative(),
  sourceMemberKey: z.string().trim().min(1).max(512),
  requestId: IdentitySchema,
  requestFacts: ProviderBrokerRequestFactsV1Schema,
}).strict();

/** Metadata authorization has no request id or inference facts because it
 * cannot reserve allowance, record usage, or acquire Provider credentials. */
export const ProviderBrokerModelCatalogAuthorizationV1Schema = z.object({
  v: z.literal(1),
  authority: SignedProviderBrokerRouteGrantV1Schema,
  expectedResourceRevision: z.number().int().nonnegative(),
}).strict();

export const ProviderBrokerAdmissionFailureCodeV1Schema = z.enum([
  'invalid_request',
  'resource_forbidden',
  'resource_unavailable',
  'resource_changed',
  'session_not_active',
  'operation_not_current',
  'execution_run_not_found',
  'execution_run_terminal',
  'execution_run_authority_unavailable',
  'broker_unavailable',
  'update_required',
  'team_credential_usage_limit',
  'token_limit_unavailable',
  'cost_limit_unavailable',
  'duplicate_request',
]);

const ProviderBrokerAdmissionFailureV1Schema = z.object({
  ok: z.literal(false),
  reasonCode: ProviderBrokerAdmissionFailureCodeV1Schema,
  /** Present only for an exhausted Team-resource ceiling. It intentionally
   * excludes limit, audience and member identities. */
  usageLimit: TeamCredentialUsageLimitDenialV1Schema.optional(),
}).strict().superRefine((value, context) => {
  if (value.usageLimit && value.reasonCode !== 'team_credential_usage_limit') {
    context.addIssue({ code: 'custom', path: ['usageLimit'], message: 'usageLimit requires an exhausted Team credential limit' });
  }
});

/**
 * Typed body of a broker application refusal (HTTP 403 on the private
 * loopback endpoint). It carries the same closed admission vocabulary and the
 * recipient-safe limit facts so the worker can raise one typed Session runtime
 * issue instead of an anonymous provider error; identities beyond the resource
 * the requester already selected are deliberately absent.
 */
export const ProviderBrokerRefusalV1Schema = z.object({
  error: z.object({
    type: z.literal('happier_provider_broker_error'),
    code: ProviderBrokerAdmissionFailureCodeV1Schema,
    resourceId: IdentitySchema,
    usageLimit: TeamCredentialUsageLimitDenialV1Schema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.usageLimit && value.code !== 'team_credential_usage_limit') {
      context.addIssue({ code: 'custom', path: ['usageLimit'], message: 'usageLimit requires an exhausted Team credential limit' });
    }
  }),
}).strict();
export type ProviderBrokerRefusalV1 = z.infer<typeof ProviderBrokerRefusalV1Schema>;

export const ProviderBrokerOpenResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    authority: SignedProviderBrokerRouteGrantV1Schema,
    target: z.object({
      custodianAccountId: IdentitySchema,
      brokerMachineId: IdentitySchema,
      endpointId: IrohEndpointIdV1Schema,
      endpointRevision: z.number().int().nonnegative(),
      /** Present only when this exact target was selected from a Machine Pool.
       * Omission preserves the released exact-Machine response shape. */
      placementKind: z.literal('machine_pool').optional(),
    }).strict(),
  }).strict(),
  ProviderBrokerAdmissionFailureV1Schema,
]);

export const ProviderBrokerRequestAdmissionResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    resourceId: IdentitySchema,
    brokerMachineId: IdentitySchema,
    source: TeamCredentialSourceBindingV1Schema,
    operation: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('session'), sessionId: IdentitySchema }).strict(),
      z.object({ kind: z.literal('execution_run'), executionRunId: IdentitySchema }).strict(),
    ]),
    usageEventId: IdentitySchema.nullable(),
  }).strict(),
  ProviderBrokerAdmissionFailureV1Schema,
]);

export const ProviderBrokerModelCatalogAuthorizationResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  ProviderBrokerAdmissionFailureV1Schema,
]);

export type ProviderBrokerConsumerV1 = z.infer<typeof ProviderBrokerConsumerV1Schema>;
export type ProviderBrokerApplicationBindingV1 = z.infer<typeof ProviderBrokerApplicationBindingV1Schema>;
/** The one admission-failure vocabulary for broker open and per-request admission. */
export type ProviderBrokerAdmissionFailureCodeV1 = z.infer<typeof ProviderBrokerAdmissionFailureCodeV1Schema>;
export type ProviderBrokerRouteGrantPayloadV1 = z.infer<typeof ProviderBrokerRouteGrantPayloadV1Schema>;
export type SignedProviderBrokerRouteGrantV1 = z.infer<typeof SignedProviderBrokerRouteGrantV1Schema>;
export type IrohProviderBrokerHandshakeV1 = z.infer<typeof IrohProviderBrokerHandshakeV1Schema>;
export type ProviderBrokerOpenRequestV1 = z.infer<typeof ProviderBrokerOpenRequestV1Schema>;
export type ProviderBrokerRequestFactsV1 = z.infer<typeof ProviderBrokerRequestFactsV1Schema>;
export type ProviderBrokerRequestAdmissionV1 = z.infer<typeof ProviderBrokerRequestAdmissionV1Schema>;
export type ProviderBrokerModelCatalogAuthorizationV1 = z.infer<typeof ProviderBrokerModelCatalogAuthorizationV1Schema>;
export type ProviderBrokerOpenResponseV1 = z.infer<typeof ProviderBrokerOpenResponseV1Schema>;
export type ProviderBrokerRequestAdmissionResponseV1 = z.infer<typeof ProviderBrokerRequestAdmissionResponseV1Schema>;
export type ProviderBrokerModelCatalogAuthorizationResponseV1 = z.infer<typeof ProviderBrokerModelCatalogAuthorizationResponseV1Schema>;

export function createProviderBrokerRouteGrantSigningInputV1(payload: ProviderBrokerRouteGrantPayloadV1): string {
  return createCanonicalJsonSigningInput(ProviderBrokerRouteGrantPayloadV1Schema.parse(payload));
}

export function encodeProviderBrokerAuthorityV1(authority: SignedProviderBrokerRouteGrantV1): string {
  const parsed = SignedProviderBrokerRouteGrantV1Schema.parse(authority);
  return encodeBase64(new TextEncoder().encode(createCanonicalJsonSigningInput(parsed)), 'base64url');
}

/** Accept only the compact signed envelope, never a Bearer prefix or handshake. */
export function decodeProviderBrokerAuthorityV1(encoded: string): SignedProviderBrokerRouteGrantV1 | null {
  if (encoded.length > PROVIDER_BROKER_AUTHORITY_MAX_ENCODED_BYTES || !/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  try {
    const bytes = decodeBase64(encoded, 'base64url');
    if (encodeBase64(bytes, 'base64url') !== encoded) return null;
    const parsed = SignedProviderBrokerRouteGrantV1Schema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
