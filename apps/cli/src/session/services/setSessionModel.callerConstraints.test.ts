import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPlainSessionOwnerMetadataEnvelopeV1,
  SessionOwnerMetadataV1Schema,
  V2SessionRecordSchema,
} from '@happier-dev/protocol';
import { runWithServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { setSessionModel } from './setSessionModel';
import { setSessionPermissionMode } from './setSessionPermissionMode';

const network = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
// Only HTTP is replaced; Session resolution, envelope parsing and metadata CAS stay real.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, ...network } };
});

const sessionId = 'c123456789012345678901234';
const modelA = { agentTargetKey: 'agent:happier.agent.codex/codex', providerConnectionId: null, modelId: 'A' };
const metadata = SessionOwnerMetadataV1Schema.parse({ v: 1, workspace: { flavor: 'codex' } });
const session = V2SessionRecordSchema.parse({
  id: sessionId, seq: 0, createdAt: 1, updatedAt: 1, active: false, activeAt: 1,
  encryptionMode: 'plain', metadataVersion: 1, metadataLayoutVersion: 1,
  dataEncryptionKey: null, share: null,
  agentState: null, agentStateVersion: 1,
  metadata: JSON.stringify({ v: 1, agentPresentation: { agentId: 'codex' } }),
  ownerMetadata: createPlainSessionOwnerMetadataEnvelopeV1(metadata),
});

describe('setSessionModel caller constraints at the effective selection boundary', () => {
  beforeEach(() => {
    network.get.mockReset();
    network.patch.mockReset();
    network.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/account/encryption/currentness')) return { status: 200, data: {
        mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
      } };
      if (url.endsWith(`/v2/sessions/${sessionId}`)) return { status: 200, data: { session } };
      throw new Error(`Unexpected GET ${url}`);
    });
    network.patch.mockResolvedValue({ status: 200, data: {
      success: true, metadataLayoutVersion: 1, sharedMetadata: { version: 2 }, agentState: { version: 2 },
    } });
  });

  it('refuses a restricted mode before metadata mutation and preserves an unrestricted caller', async () => {
    await runWithServerHttpBaseUrl('https://home.example.test', async () => {
      const input = { credentials: { token: 'account-token', encryption: null }, idOrPrefix: sessionId, permissionMode: 'yolo' as const };
      await expect(setSessionPermissionMode({ ...input, callerInputConstraints: { models: null, permissionModes: ['default'] } }))
        .resolves.toMatchObject({ ok: false, code: 'permission_mode_not_granted' });
      expect(network.patch).not.toHaveBeenCalled();
      await expect(setSessionPermissionMode(input)).resolves.toMatchObject({ ok: true });
    });
  });

  it.each(['native', 'team resource'] as const)('refuses a restricted %s ref but preserves an unrestricted caller in the same Session', async (kind) => {
    const modelInput = kind === 'native'
      ? { modelId: 'B', providerConnectionId: null }
      : { teamCredentialModel: {
          kind: 'team_credential_provider_model' as const, teamId: 'team-1', resourceId: 'resource-1',
          expectedResourceRevision: 7, deliveryMode: 'brokered' as const,
          agentTargetKey: modelA.agentTargetKey, modelId: 'B',
        } };
    const input = { credentials: { token: 'account-token', encryption: null }, idOrPrefix: sessionId, ...modelInput };
    await runWithServerHttpBaseUrl('https://home.example.test', async () => {
      await expect(setSessionModel({ ...input, callerInputConstraints: { models: [modelA], permissionModes: null } }))
        .resolves.toMatchObject({ ok: false, code: 'model_not_granted' });
      expect(network.patch).not.toHaveBeenCalled();
      await expect(setSessionModel(input)).resolves.toMatchObject({ ok: true, status: 'intent_updated' });
    });
  });
});
