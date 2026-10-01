import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectLegacySessionAccessCapabilitiesV1 } from '@happier-dev/protocol';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';

const { fetchSessionByIdCompat } = vi.hoisted(() => ({
  fetchSessionByIdCompat: vi.fn(),
}));

vi.mock('@/session/transport/http/sessionsHttp', async (importActual) => ({
  ...await importActual<typeof import('@/session/transport/http/sessionsHttp')>(),
  fetchSessionByIdCompat,
}));

describe('resolveReplaySourceContextAuthority', () => {
  const credentials = { token: 'token', encryption: null } as const;

  beforeEach(() => {
    fetchSessionByIdCompat.mockReset();
  });

  it('retains the managed source directory as private seed evidence only when source machine identity agrees', async () => {
    fetchSessionByIdCompat.mockResolvedValue(createSessionRecordFixture({
      id: 'managed-source',
      encryptionMode: 'plain',
      metadata: JSON.stringify({ machineId: 'machine-1', path: '/private/source', sessionDirectoryV1: { v: 1, kind: 'managed' } }),
      machineId: 'machine-1',
      effectiveAccess: {
        v: 1,
        level: 'owner',
        sources: [{ kind: 'owner' }],
        capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'owner' }),
      },
    }));
    const { resolveReplaySourceContextAuthority } = await import('./resolveReplaySourceContextAuthority');
    await expect(resolveReplaySourceContextAuthority({ credentials, sourceSessionId: 'managed-source' }))
      .resolves.toMatchObject({ status: 'owned', sourceMachineId: 'machine-1', managedDirectorySeed: {
        sourceSessionId: 'managed-source', sourcePath: '/private/source',
      } });
    fetchSessionByIdCompat.mockResolvedValue(createSessionRecordFixture({
      id: 'managed-source', encryptionMode: 'plain', machineId: 'machine-other',
      metadata: JSON.stringify({ machineId: 'machine-1', path: '/private/source', sessionDirectoryV1: { v: 1, kind: 'managed' } }),
      effectiveAccess: { v: 1, level: 'owner', sources: [{ kind: 'owner' }], capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'owner' }) },
    }));
    await expect(resolveReplaySourceContextAuthority({ credentials, sourceSessionId: 'managed-source' }))
      .resolves.toEqual({ status: 'owned', sourceMachineId: null, managedSource: true });
  });

  it('accepts a current owner projection when the released share marker is absent', async () => {
    fetchSessionByIdCompat.mockResolvedValue(createSessionRecordFixture({
      id: 'owned-source',
      encryptionMode: 'plain',
      metadata: JSON.stringify({ machineId: 'machine-1' }),
      machineId: 'machine-1',
      effectiveAccess: {
        v: 1,
        level: 'owner',
        sources: [{ kind: 'owner' }],
        capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'owner' }),
      },
    }));

    const { resolveReplaySourceContextAuthority } = await import('./resolveReplaySourceContextAuthority');
    await expect(resolveReplaySourceContextAuthority({
      credentials,
      sourceSessionId: 'owned-source',
    })).resolves.toEqual({ status: 'owned', sourceMachineId: 'machine-1' });
  });

  it('rejects current collective access even if a stale released owner marker is present', async () => {
    fetchSessionByIdCompat.mockResolvedValue(createSessionRecordFixture({
      id: 'team-source',
      encryptionMode: 'plain',
      metadata: JSON.stringify({ machineId: 'machine-1' }),
      machineId: 'machine-1',
      share: null,
      effectiveAccess: {
        v: 1,
        level: 'view',
        sources: [{ kind: 'team', teamId: 'team-1', requiredByTeamPolicy: false }],
        capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'view' }),
      },
    }));

    const { resolveReplaySourceContextAuthority } = await import('./resolveReplaySourceContextAuthority');
    await expect(resolveReplaySourceContextAuthority({
      credentials,
      sourceSessionId: 'team-source',
    })).resolves.toEqual({ status: 'not_owned' });
  });
});
