import { describe, expect, it, vi } from 'vitest';
import {
  ProviderConnectionIdSchema,
  ProviderConnectionSecurityFingerprintV1Schema,
  ProviderCredentialTransportV1Schema,
  TeamCredentialDirectMaterialPreparationResponseV1Schema,
} from '@happier-dev/protocol';
import { computeTeamCredentialSourceMemberKeyV1 } from '@happier-dev/protocol/teams';

import type { TeamCredentialSourceSnapshot } from '@/providers/broker/teamCredentialSourceSnapshot';
import { reconcileTeamCredentialDirectMaterial } from './reconcileTeamCredentialDirectMaterial';

const sourceMember = Object.freeze({
  kind: 'provider_credential_slot' as const,
  connectionId: ProviderConnectionIdSchema.parse('pc_source'),
  credentialSlotId: 'apiKey',
});
const sourceSnapshot: TeamCredentialSourceSnapshot = Object.freeze({
  currentness: Object.freeze({
    sourceMember,
    sourceVersion: 'source-v2',
    isCurrent: vi.fn(async () => true),
  }),
  material: Object.freeze({
    kind: 'provider_api_key' as const,
    value: 'source-secret',
    runtimeBinding: Object.freeze({
      provider: Object.freeze({ identity: Object.freeze({ pluginId: 'provider.test', localId: 'test' }), definitionRevision: 1 }),
      endpoint: Object.freeze({
        endpointTemplateId: 'responses', normalizedUrl: 'https://api.example.test/v1',
        protocol: 'openai-responses' as const, publicHeaders: Object.freeze({}),
      }),
      credentialTransport: ProviderCredentialTransportV1Schema.parse({
        id: 'api-key', protocols: ['openai-responses'], uses: ['runtime'],
        destination: Object.freeze({ kind: 'httpHeader' as const, name: 'Authorization', format: 'bearer' as const }),
      }),
    }),
  }),
});
const sourceMemberKey = computeTeamCredentialSourceMemberKeyV1(sourceMember);

describe('reconcileTeamCredentialDirectMaterial', () => {
  it('consumes paginated current preparation and publishes each recipient through the canonical producer', async () => {
    const firstPage = TeamCredentialDirectMaterialPreparationResponseV1Schema.parse({
        homeServerIdentityId: 'home', teamId: 'team', resourceId: 'resource', resourceRevision: 4,
        source: { v: 1, kind: 'provider_connection', connectionId: sourceMember.connectionId, connectionSecurityFingerprint: ProviderConnectionSecurityFingerprintV1Schema.parse('connection-security:v1:test'), credentialSlotId: 'apiKey' },
        sourceMember, sourceCredentialIncarnation: null, publishedSourceVersion: 'source-v1',
        recipients: [{ recipientAccountId: 'a', recipientMode: 'plain', recipientContentPublicKeyFingerprint: null, recipientContentPublicKey: null, expectedStoredSourceVersion: null }],
        nextCursor: 'next',
      });
    const secondPage = TeamCredentialDirectMaterialPreparationResponseV1Schema.parse({
        homeServerIdentityId: 'home', teamId: 'team', resourceId: 'resource', resourceRevision: 4,
        source: { v: 1, kind: 'provider_connection', connectionId: sourceMember.connectionId, connectionSecurityFingerprint: ProviderConnectionSecurityFingerprintV1Schema.parse('connection-security:v1:test'), credentialSlotId: 'apiKey' },
        sourceMember, sourceCredentialIncarnation: null, publishedSourceVersion: 'source-v2',
        recipients: [{ recipientAccountId: 'b', recipientMode: 'plain', recipientContentPublicKeyFingerprint: null, recipientContentPublicKey: null, expectedStoredSourceVersion: 'source-v1' }],
        nextCursor: null,
      });
    const fetchPreparation = vi.fn(async (input: Readonly<{
      teamId: string;
      resourceId: string;
      sourceMemberKey: string;
      cursor?: string;
      signal?: AbortSignal;
    }>) => (
      input.cursor === 'next' ? secondPage : firstPage
    ));
    const upsert = vi.fn(async () => ({ ok: true as const }));

    await expect(reconcileTeamCredentialDirectMaterial({
      teamId: 'team', resourceId: 'resource', sourceMemberKey,
      fetchPreparation,
      resolveSourceSnapshot: vi.fn(async () => sourceSnapshot),
      upsert,
    })).resolves.toEqual({ ok: true, prepared: 2 });

    expect(fetchPreparation).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor: undefined }));
    expect(fetchPreparation).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'next' }));
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedPublishedSourceVersion: 'source-v1' }));
    expect(upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedPublishedSourceVersion: 'source-v2' }));
  });

  it('fails closed when the preparation source member differs from the canonical snapshot', async () => {
    const upsert = vi.fn();
    await expect(reconcileTeamCredentialDirectMaterial({
      teamId: 'team', resourceId: 'resource', sourceMemberKey: 'member',
      fetchPreparation: vi.fn(async () => TeamCredentialDirectMaterialPreparationResponseV1Schema.parse({
        homeServerIdentityId: 'home', teamId: 'team', resourceId: 'resource', resourceRevision: 1,
        source: { v: 1, kind: 'provider_connection', connectionId: sourceMember.connectionId, connectionSecurityFingerprint: ProviderConnectionSecurityFingerprintV1Schema.parse('connection-security:v1:test'), credentialSlotId: 'apiKey' },
        sourceMember: { ...sourceMember, credentialSlotId: 'other' }, sourceCredentialIncarnation: null, publishedSourceVersion: null,
        recipients: [], nextCursor: null,
      })),
      resolveSourceSnapshot: vi.fn(async () => sourceSnapshot),
      upsert,
    })).resolves.toEqual({ ok: false, reason: 'source_changed', prepared: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });
});
