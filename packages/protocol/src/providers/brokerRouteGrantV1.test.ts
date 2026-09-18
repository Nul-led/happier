import { describe, expect, it } from 'vitest';
import {
  ProviderBrokerRouteGrantPayloadV1Schema,
  SignedProviderBrokerRouteGrantV1Schema,
  IrohProviderBrokerHandshakeV1Schema,
  ProviderBrokerOpenRequestV1Schema,
  ProviderBrokerRequestAdmissionV1Schema,
  ProviderBrokerRequestAdmissionResponseV1Schema,
  ProviderBrokerModelCatalogAuthorizationV1Schema,
  ProviderBrokerModelCatalogAuthorizationResponseV1Schema,
  encodeProviderBrokerAuthorityV1,
  decodeProviderBrokerAuthorityV1,
  PROVIDER_BROKER_AUTHORITY_MAX_ENCODED_BYTES,
} from './brokerRouteGrantV1.js';
import {
  TeamCredentialResourceCreateInputV1Schema,
  TeamCredentialSourceBindingV1Schema,
} from '../teams/credentials/resourceV1.js';

const payload = {
  v: 1, grantId: 'grant', aud: 'happier-provider-broker-route-v1', issuedAt: 100, expiresAt: 200,
  teamId: 'team', resourceId: 'resource',
  expectedResourceRevision: 3,
  modelId: 'gpt-5',
  sourceRevision: 'source-revision-3',
  initiator: { accountId: 'requester', machineId: 'worker', endpointId: 'a'.repeat(64) },
  target: { custodianAccountId: 'custodian', machineId: 'broker', endpointId: 'b'.repeat(64) },
  consumer: { kind: 'session', sessionId: 'session' },
  application: {
    agentTargetKey: 'codex',
    implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
    endpointTemplateId: 'openai-responses',
    protocol: 'openai-responses',
  },
};
const authority = { payload, signature: { alg: 'Ed25519', keyId: 'home', valueBase64Url: 'A'.repeat(86) } };

describe('Provider broker authority V1', () => {
  it('initializes the broker and Team credential resource schema graph', () => {
    expect(ProviderBrokerRequestAdmissionResponseV1Schema).toBeDefined();
    expect(TeamCredentialResourceCreateInputV1Schema).toBeDefined();
    expect(TeamCredentialSourceBindingV1Schema).toBeDefined();
  });

  it('round-trips the exact strict authority for Session and Run consumers', () => {
    for (const consumer of [payload.consumer, { kind: 'execution_run', executionRunId: 'run' }]) {
      const grant = SignedProviderBrokerRouteGrantV1Schema.parse({
        ...authority,
        payload: {
          ...payload,
          consumer,
          ...(consumer.kind === 'execution_run' ? { executionRunOccurrenceId: 'occurrence' } : {}),
        },
      });
      expect(decodeProviderBrokerAuthorityV1(encodeProviderBrokerAuthorityV1(grant))).toEqual(grant);
      expect(IrohProviderBrokerHandshakeV1Schema.parse({ v: 1, kind: 'provider_broker', authority: grant }).authority).toEqual(grant);
    }
  });

  it('requires an exact occurrence on signed Run authority while open resolves it daemon-side', () => {
    expect(ProviderBrokerOpenRequestV1Schema.safeParse({
      v: 1,
      resourceId: 'resource', expectedResourceRevision: 3,
      modelId: 'gpt-5', sourceRevision: 'source-revision-3', initiatorMachineId: 'worker',
      consumer: { kind: 'execution_run', executionRunId: 'run' },
      application: payload.application,
    }).success).toBe(true);
    expect(ProviderBrokerRouteGrantPayloadV1Schema.safeParse({
      ...payload,
      consumer: { kind: 'execution_run', executionRunId: 'run' },
    }).success).toBe(false);
  });

  it('keeps broker open and per-request admission inputs recursively closed', () => {
    expect(ProviderBrokerOpenRequestV1Schema.parse({
      v: 1,
      resourceId: 'resource',
      expectedResourceRevision: 3,
      modelId: 'gpt-5',
      sourceRevision: 'source-revision-3',
      initiatorMachineId: 'worker',
      consumer: { kind: 'session', sessionId: 'session' },
      application: payload.application,
      refreshAuthority: authority,
    })).toEqual({
      v: 1,
      resourceId: 'resource',
      expectedResourceRevision: 3,
      modelId: 'gpt-5',
      sourceRevision: 'source-revision-3',
      initiatorMachineId: 'worker',
      consumer: { kind: 'session', sessionId: 'session' },
      application: payload.application,
      refreshAuthority: authority,
    });
    expect(ProviderBrokerOpenRequestV1Schema.safeParse({
      v: 1,
      resourceId: 'resource',
      initiatorMachineId: 'worker',
      consumer: { kind: 'session', sessionId: 'session' },
      accountId: 'forged',
    }).success).toBe(false);
    expect(ProviderBrokerOpenRequestV1Schema.safeParse({
      v: 1,
      resourceId: 'resource',
      expectedResourceRevision: 3,
      modelId: 'gpt-5',
      sourceRevision: 'source-revision-3',
      initiatorMachineId: 'worker',
      consumer: { kind: 'session', sessionId: 'session' },
      application: payload.application,
      brokerMachineId: 'caller-chosen-machine',
    }).success).toBe(false);

    const admission = {
      v: 1,
      authority,
      expectedResourceRevision: 3,
      sourceMemberKey: 'opaque-source-member-key',
      requestId: 'request-1',
      requestFacts: {
        generation: true,
        routeKind: 'openai_chat_completions',
        modelId: 'gpt-5',
        reasoningEffort: null,
      },
    } as const;
    expect(ProviderBrokerRequestAdmissionV1Schema.parse(admission)).toEqual(admission);
    expect(ProviderBrokerRequestAdmissionV1Schema.safeParse({
      ...admission,
      expectedResourceRevision: 0,
    }).success).toBe(true);
    expect(ProviderBrokerRequestAdmissionV1Schema.safeParse({
      ...admission,
      expectedResourceRevision: -1,
    }).success).toBe(false);
    expect(ProviderBrokerRequestAdmissionV1Schema.safeParse({
      ...admission,
      requestFacts: { ...admission.requestFacts, prompt: 'must never cross Home admission' },
    }).success).toBe(false);

    const metadataAuthorization = {
      v: 1,
      authority,
      expectedResourceRevision: 3,
    } as const;
    expect(ProviderBrokerModelCatalogAuthorizationV1Schema.parse(metadataAuthorization)).toEqual(metadataAuthorization);
    expect(ProviderBrokerModelCatalogAuthorizationV1Schema.safeParse({
      ...metadataAuthorization,
      expectedResourceRevision: 0,
    }).success).toBe(true);
    expect(ProviderBrokerModelCatalogAuthorizationV1Schema.safeParse({
      ...metadataAuthorization,
      requestFacts: admission.requestFacts,
    }).success).toBe(false);
    expect(ProviderBrokerModelCatalogAuthorizationResponseV1Schema.parse({ ok: true })).toEqual({ ok: true });
  });

  it('rejects unknown policy, plumbing and ambiguous identity at every boundary', () => {
    const invalidPayloads = [
      ...['resourceRevision', 'port', 'secret'].map((key) => ({ ...payload, [key]: 1 })),
      { ...payload, aud: 'happier-daemon-route-grant' },
      { ...payload, expiresAt: payload.issuedAt },
      { ...payload, initiator: { ...payload.initiator, accountId: '' } },
      { ...payload, target: { ...payload.target, custodianAccountId: payload.initiator.accountId } },
      { ...payload, target: { ...payload.target, machineId: payload.initiator.machineId } },
      { ...payload, target: { ...payload.target, endpointId: payload.initiator.endpointId } },
      { ...payload, initiator: { ...payload.initiator, port: 1234 } },
      { ...payload, application: { ...payload.application, endpointTemplateId: '' } },
      { ...payload, application: { ...payload.application, implementationIdentity: { ...payload.application.implementationIdentity, localId: '' } } },
      { ...payload, consumer: { ...payload.consumer, sessionId: '' } },
      { ...payload, consumer: { ...payload.consumer, executionRunId: 'run' } },
    ];
    for (const value of invalidPayloads) expect(ProviderBrokerRouteGrantPayloadV1Schema.safeParse(value).success).toBe(false);
    expect(SignedProviderBrokerRouteGrantV1Schema.safeParse({ ...authority, secret: 'x' }).success).toBe(false);
    expect(SignedProviderBrokerRouteGrantV1Schema.safeParse({ ...authority, signature: { ...authority.signature, valueBase64Url: 'A'.repeat(85) } }).success).toBe(false);
    expect(IrohProviderBrokerHandshakeV1Schema.safeParse({ v: 1, kind: 'provider_broker', authority, port: 1234 }).success).toBe(false);
    expect(decodeProviderBrokerAuthorityV1('Bearer something')).toBeNull();
    expect(decodeProviderBrokerAuthorityV1(Buffer.from(JSON.stringify({ v: 1, kind: 'provider_broker', authority })).toString('base64url'))).toBeNull();
  });

  it('bounds encoded authority before transport and fits handshake and capability headers', () => {
    const grant = SignedProviderBrokerRouteGrantV1Schema.parse(authority);
    const encoded = encodeProviderBrokerAuthorityV1(grant);
    expect(Buffer.byteLength(JSON.stringify({ v: 1, kind: 'provider_broker', authority: grant }))).toBeLessThan(64 * 1024);
    expect(Buffer.byteLength(`Authorization: Bearer ${encoded}\r\nX-Happier-Machine-Local-Capability: ${'x'.repeat(64)}\r\n`)).toBeLessThan(16 * 1024);
    const envelopeBytes = Buffer.from(encoded, 'base64url').byteLength;
    const maximumResourceBytes = Math.floor(PROVIDER_BROKER_AUTHORITY_MAX_ENCODED_BYTES * 3 / 4) - envelopeBytes + payload.resourceId.length;
    const maximumGrant = SignedProviderBrokerRouteGrantV1Schema.parse({ ...authority, payload: { ...payload, resourceId: 'x'.repeat(maximumResourceBytes) } });
    const maximumEncoded = encodeProviderBrokerAuthorityV1(maximumGrant);
    expect(Buffer.byteLength(`Authorization: Bearer ${maximumEncoded}\r\nX-Happier-Machine-Local-Capability: ${'x'.repeat(64)}\r\n`)).toBeLessThanOrEqual(16 * 1024);
    expect(decodeProviderBrokerAuthorityV1(`${encoded}=`)).toBeNull();
    expect(decodeProviderBrokerAuthorityV1('A'.repeat(PROVIDER_BROKER_AUTHORITY_MAX_ENCODED_BYTES + 1))).toBeNull();
    const oversized = { ...authority, payload: { ...payload, resourceId: 'x'.repeat(PROVIDER_BROKER_AUTHORITY_MAX_ENCODED_BYTES) } };
    expect(SignedProviderBrokerRouteGrantV1Schema.safeParse(oversized).success).toBe(false);
    expect(IrohProviderBrokerHandshakeV1Schema.safeParse({ v: 1, kind: 'provider_broker', authority: oversized }).success).toBe(false);
  });
});
