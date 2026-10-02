import { describe, expect, it } from 'vitest';

import {
  DaemonVoiceClientAccountOperationResponseV1Schema,
  DaemonVoiceClientRawCredentialAuthorizationInspectResponseV1Schema,
  DaemonVoiceClientRawCredentialAuthorizationRequestV1Schema,
  DaemonVoiceClientRawCredentialMaterializeRequestV1Schema,
  DaemonVoiceClientRawCredentialMaterializeResponseV1Schema,
} from './voiceCredentials.js';

const contribution = { pluginId: 'acme.voice', localId: 'browser' } as const;
const rawGrant = {
  realm: 'web' as const,
  phase: 'connection' as const,
  request: {
    kind: 'httpHeaders' as const,
    origin: 'https://voice.example.test',
    headerNames: ['authorization'],
  },
};

describe('daemon Voice raw credential authorization wire', () => {
  it('admits the ephemeral operation response but rejects a credential-header export', () => {
    const response = { ok: true, response: {
      status: 200, finalUrl: 'https://voice.example.test/client-secret',
      headers: { 'content-type': 'application/json' }, bodyBase64: 'e30=',
    } };
    expect(DaemonVoiceClientAccountOperationResponseV1Schema.parse(response)).toEqual(response);
    expect(DaemonVoiceClientAccountOperationResponseV1Schema.safeParse({
      ok: true, headers: { authorization: 'Bearer source-credential' },
    }).success).toBe(false);
    expect(DaemonVoiceClientAccountOperationResponseV1Schema.safeParse({
      ...response, headers: { authorization: 'Bearer source-credential' },
    }).success).toBe(false);
  });
  it('preserves the legacy raw-materialization shape while carrying an optional host callback receipt', () => {
    const cacheIdentity = {
      artifactDigest: `sha256:${'b'.repeat(64)}`,
    };
    const request = {
      contribution,
      platform: 'web' as const,
      cacheIdentity,
      phase: 'connection' as const,
      request: {
        kind: 'httpHeaders' as const,
        origin: 'https://voice.example.test',
        headerNames: ['authorization'],
      },
    };
    const revision = 'csr_0123456789ABCDEFGHJKMNPQRS';

    expect(DaemonVoiceClientRawCredentialMaterializeRequestV1Schema.parse(request))
      .toEqual(request);
    expect(DaemonVoiceClientRawCredentialMaterializeRequestV1Schema.parse({
      ...request,
      expectedCredentialRevision: revision,
    })).toMatchObject({ expectedCredentialRevision: revision });
    expect(DaemonVoiceClientRawCredentialMaterializeRequestV1Schema.safeParse({
      ...request,
      expectedCredentialRevision: 'not-a-revision',
    }).success).toBe(false);

    const success = {
      ok: true as const,
      materialization: {
        kind: 'httpHeaders' as const,
        headers: { authorization: 'Bearer host-only' },
      },
    };
    expect(DaemonVoiceClientRawCredentialMaterializeResponseV1Schema.parse(success))
      .toEqual(success);
    expect(DaemonVoiceClientRawCredentialMaterializeResponseV1Schema.parse({
      ...success,
      credentialRevision: revision,
    })).toMatchObject({ credentialRevision: revision });
  });

  it('accepts only the qualified contribution and exact raw tuple from callers', () => {
    expect(DaemonVoiceClientRawCredentialAuthorizationRequestV1Schema.parse({ contribution, rawGrant }))
      .toEqual({ contribution, rawGrant });
    expect(DaemonVoiceClientRawCredentialAuthorizationRequestV1Schema.safeParse({
      contribution,
      rawGrant,
      subject: { kind: 'general' },
    }).success).toBe(false);
    expect(DaemonVoiceClientRawCredentialAuthorizationRequestV1Schema.safeParse({
      contribution,
      rawGrant: { realm: 'web', phase: 'connection' },
    }).success).toBe(false);

    const parsed = DaemonVoiceClientRawCredentialAuthorizationInspectResponseV1Schema.parse({
      ok: true,
      authorization: {
        pluginId: contribution.pluginId,
        capability: 'credentials.materialize.raw',
        targetScope: { kind: 'account' },
        subject: {
          kind: 'credential_access_disclosure',
          contribution,
          credentialSlotId: 'api_key',
          purpose: 'voice.browser',
          accessDeclarationDigest: 'b'.repeat(64),
          selectedAuthorityDigest: 'c'.repeat(64),
          selectedRawAccessDigest: 'd'.repeat(64),
        },
        authoritySource: {
          kind: 'machine_installation',
          machineId: 'machine-a',
          installationId: 'installation-a',
        },
        disclosures: [{
          sourceClass: { kind: 'savedSecret', secretKinds: ['apiKey'] },
          realm: 'web',
          phase: 'connection',
          materialization: 'httpHeaders',
          origin: 'https://voice.example.test',
          destination: 'authorization',
        }],
      },
      review: {
        plugin: { id: contribution.pluginId, name: 'Acme Voice', version: '2.0.0' },
        package: { identity: '@acme/voice' },
        distribution: {
          kind: 'npm',
          packageName: '@acme/voice',
          registryOrigin: 'https://registry.npmjs.org',
        },
        publisher: { status: 'unavailable' },
        contribution: { identity: contribution, name: 'Browser Voice' },
        credentialSlot: { id: 'api_key', name: 'API key', purpose: 'voice.browser' },
      },
    });
    expect(parsed.ok && parsed.authorization.disclosures[0]?.destination).toBe('authorization');
    expect(DaemonVoiceClientRawCredentialAuthorizationInspectResponseV1Schema.safeParse({
      ...parsed,
      review: parsed.ok ? {
        ...parsed.review,
        distribution: {
          kind: 'archive',
          locator: 'https://example.test/private.tgz?token=secret',
        },
      } : undefined,
    }).success).toBe(false);
  });
});
