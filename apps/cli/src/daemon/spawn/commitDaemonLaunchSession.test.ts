import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionInitialAccessServerError } from '@/api/session/sessionCreationInitialAccess';
import type { SpawnSessionOptions } from '@/session/shared/spawnSessionContract';

// Network boundary only: the Session row read, the Account currentness read and
// the archive mutation are HTTP calls. Attach-context building stays real.
const network = vi.hoisted(() => ({
  fetchSessionByIdCompat: vi.fn(),
  fetchAccountEncryptionCurrentness: vi.fn(),
  setSessionArchivedStateById: vi.fn(),
}));
vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>()),
  fetchSessionByIdCompat: network.fetchSessionByIdCompat,
}));
vi.mock('@/api/client/connectedServiceCredentialApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client/connectedServiceCredentialApi')>()),
  fetchAccountEncryptionCurrentness: network.fetchAccountEncryptionCurrentness,
}));
vi.mock('@/session/services/sessionArchivedStateById', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/session/services/sessionArchivedStateById')>()),
  setSessionArchivedStateById: network.setSessionArchivedStateById,
}));

import {
  commitDaemonLaunchSession,
  daemonLaunchRequiresCommittedSession,
  withoutFreshSessionCreationFields,
} from './commitDaemonLaunchSession';

const credentials = { token: 'token-1', encryption: null } as const;
const purpose = { consumer: { pluginId: 'happier.agent.codex', localId: 'codex' }, purpose: 'primary' };
const disclosedMember = { service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' }, accountId: 'source-member' };
const teamSlotBinding = {
  v: 1 as const,
  slot: { kind: 'connected_service_purpose' as const, purpose },
  resourceId: 'resource-1',
  expectedResourceRevision: 3,
  deliveryMode: 'direct' as const,
  teamId: 'team-1',
};
const directTeamOptions: SpawnSessionOptions = {
  directory: '/repo',
  spawnNonce: 'nonce-1',
  connectedServices: {
    v: 2,
    bindingsByServiceId: {
      'happier.agent.codex/openai-codex': {
        source: 'team_resource', resourceId: 'resource-1', deliveryMode: 'direct', disclosedMember,
      },
    },
  },
  teamCredentialBindings: [teamSlotBinding],
  primaryTeamId: 'team-1',
  mcpSelection: { v: 1, managedServersEnabled: true, forceIncludeServerIds: ['docs'], forceExcludeServerIds: [] },
} as SpawnSessionOptions;

function plainSessionRow(id: string, metadata: Record<string, unknown>) {
  return {
    id,
    seq: 0,
    encryptionMode: 'plain',
    metadata: JSON.stringify(metadata),
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    dataEncryptionKey: null,
  };
}

describe('commitDaemonLaunchSession', () => {
  beforeEach(() => {
    network.fetchSessionByIdCompat.mockReset();
    network.fetchAccountEncryptionCurrentness.mockReset().mockResolvedValue({
      mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
    });
    network.setSessionArchivedStateById.mockReset().mockResolvedValue({ archivedAt: 1 });
  });

  it('commits only launches whose connected services select directly delivered Team material', () => {
    expect(daemonLaunchRequiresCommittedSession(directTeamOptions)).toBe(true);
    expect(daemonLaunchRequiresCommittedSession({
      ...directTeamOptions,
      connectedServices: {
        v: 2,
        bindingsByServiceId: {
          'happier.agent.codex/openai-codex': { source: 'team_resource', resourceId: 'resource-1', deliveryMode: 'brokered' },
        },
      },
    } as SpawnSessionOptions)).toBe(false);
    expect(daemonLaunchRequiresCommittedSession({ directory: '/repo' })).toBe(false);
  });

  it('creates the Session with its Team slot binding before launch, then continues as an attach to it', async () => {
    const getOrCreateSession = vi.fn(async (input: { metadata: Record<string, unknown> }) => ({
      id: 'session-committed',
      metadata: input.metadata,
      sessionCreationOutcome: {
        disposition: 'created' as const,
        organizationPlacement: { folderId: null, tagIds: [] },
      },
    }));
    network.fetchSessionByIdCompat.mockImplementation(async () =>
      plainSessionRow('session-committed', getOrCreateSession.mock.calls[0]![0].metadata));

    const committed = await commitDaemonLaunchSession({
      api: { getOrCreateSession } as never,
      credentials,
      options: directTeamOptions,
      directory: '/repo',
      agentModeId: 'plan',
      agentModeUpdatedAt: 5,
    });

    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const createInput = getOrCreateSession.mock.calls[0]![0] as Record<string, unknown> & {
      metadata: Record<string, unknown>;
    };
    // The Home admits the Team binding in the create transaction.
    expect(createInput).toMatchObject({
      teamCredentialBindings: [teamSlotBinding],
      primaryTeamId: 'team-1',
    });
    // Intents an attaching runner never takes from its own process are
    // seeded by the creator.
    expect(createInput.metadata).toMatchObject({
      path: '/repo',
      mcpSelectionV1: { v: 1, forceIncludeServerIds: ['docs'] },
      connectedServiceMaterializationIdentityV1: committed.session.options.connectedServiceMaterializationIdentityV1,
    });
    expect(JSON.stringify(createInput.metadata)).toContain('"plan"');
    expect(committed.session).toMatchObject({
      sessionId: 'session-committed',
      created: true,
      sessionCreationOutcome: { disposition: 'created' },
      attachPayload: { v: 2, encryptionMode: 'plain' },
      options: { attachMetadataIdentityPolicy: 'replace_with_runtime_identity' },
    });
    expect(withoutFreshSessionCreationFields(committed.session.options)).not.toHaveProperty('teamCredentialBindings');
    expect(withoutFreshSessionCreationFields(committed.session.options)).not.toHaveProperty('primaryTeamId');
  });

  it('keeps the identity a rejoined Session already persisted', async () => {
    const persistedIdentity = { v: 1, id: 'csm_persisted_identity_0001', createdAt: 1, source: 'first_spawn' };
    const getOrCreateSession = vi.fn(async () => ({
      id: 'session-rejoined',
      metadata: { path: '/repo', host: 'h', connectedServiceMaterializationIdentityV1: persistedIdentity },
      sessionCreationOutcome: {
        disposition: 'rejoined' as const,
        organizationPlacement: { folderId: null, tagIds: [] },
      },
    }));
    network.fetchSessionByIdCompat.mockResolvedValue(plainSessionRow('session-rejoined', { path: '/repo', host: 'h' }));

    const committed = await commitDaemonLaunchSession({
      api: { getOrCreateSession } as never,
      credentials,
      options: directTeamOptions,
      directory: '/repo',
    });

    expect(committed).toMatchObject({
      ok: true,
      session: {
        created: false,
        options: { connectedServiceMaterializationIdentityV1: persistedIdentity },
      },
    });
  });

  it('returns the exact creation refusal and creates nothing', async () => {
    const getOrCreateSession = vi.fn(async () => {
      throw new SessionInitialAccessServerError('session_access_forbidden', 403);
    });

    await expect(commitDaemonLaunchSession({
      api: { getOrCreateSession } as never,
      credentials,
      options: directTeamOptions,
      directory: '/repo',
    })).resolves.toMatchObject({
      ok: false,
      result: {
        type: 'error',
        errorCode: 'SPAWN_VALIDATION_FAILED',
        errorDetail: { kind: 'session_creation_access_refused' },
      },
    });
    expect(network.fetchSessionByIdCompat).not.toHaveBeenCalled();
  });

  it('archives a Session it created when the launch cannot attach to it', async () => {
    const getOrCreateSession = vi.fn(async () => ({
      id: 'session-unattachable',
      metadata: { path: '/repo', host: 'h' },
      sessionCreationOutcome: {
        disposition: 'created' as const,
        organizationPlacement: { folderId: null, tagIds: [] },
      },
    }));
    network.fetchSessionByIdCompat.mockResolvedValue(null);

    await expect(commitDaemonLaunchSession({
      api: { getOrCreateSession } as never,
      credentials,
      options: directTeamOptions,
      directory: '/repo',
    })).resolves.toMatchObject({ ok: false, result: { type: 'error' } });
    expect(network.setSessionArchivedStateById).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-unattachable',
      archived: true,
    }));
  });
});
