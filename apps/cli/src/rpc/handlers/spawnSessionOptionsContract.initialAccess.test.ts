import { describe, expect, it } from 'vitest';
import { SpawnDaemonSessionRequestSchema, pickDefinedSpawnSessionOptions } from './spawnSessionOptionsContract';
import { computeDaemonSpawnRequestKey } from '@/daemon/spawn/spawnRequestCoalescer';
import { buildHappySessionControlArgs } from '@/daemon/sessionSpawnArgs';
import { partitionProviderSessionArgs } from '@/cli/providerSessionArgPartition';
import { buildSessionRunnerRespawnDescriptorV1FromSpawnOptions, buildSpawnSessionOptionsFromRespawnDescriptorV1 } from '@/daemon/processSupervision/sessionRunnerRespawnDescriptor';

describe('fresh Session initial access admission', () => {
  const initialAccess = { grants: [{ subject: { kind: 'account' as const, accountId: 'recipient' }, accessLevel: 'edit' as const, canApprovePermissions: true }] };

  it('retains grants for fresh creation including provider resume', () => {
    const parsed = SpawnDaemonSessionRequestSchema.parse({ directory: '/work', sessionId: 'caller-reservation', resume: 'provider-session', initialAccess, primaryTeamId: null });
    expect(parsed.initialAccess).toEqual(initialAccess);
    expect(pickDefinedSpawnSessionOptions(parsed).initialAccess).toEqual(initialAccess);
    expect(pickDefinedSpawnSessionOptions(parsed).primaryTeamId).toBeNull();
  });

  it('rejects authority on existing-session and daemon resume operations', () => {
    for (const existing of [{ existingSessionId: 'existing' }, { type: 'resume-session' }]) {
      expect(SpawnDaemonSessionRequestSchema.safeParse({ directory: '/work', initialAccess, ...existing }).success).toBe(false);
    }
  });

  it('distinguishes different initial access and Team contexts in spawn semantics', () => {
    const base = { directory: '/work', initialAccess };
    expect(computeDaemonSpawnRequestKey(base).key).not.toBe(computeDaemonSpawnRequestKey({ ...base, initialAccess: { grants: [] } }).key);
    expect(computeDaemonSpawnRequestKey({ ...base, primaryTeamId: 'team-a' }).key).not.toBe(computeDaemonSpawnRequestKey({ ...base, primaryTeamId: 'team-b' }).key);
  });

  it('round trips private path and explicit nullable Team context as host control arguments', () => {
    for (const primaryTeamId of [null, 'team-a']) {
      const args = buildHappySessionControlArgs({ initialAccessFilePath: '/private home/draft.json', primaryTeamId });
      expect(partitionProviderSessionArgs({ args: ['codex', '--started-by', 'daemon', ...args], providerSubcommand: 'codex' })).toMatchObject({
        initialAccessFilePath: '/private home/draft.json', primaryTeamId, providerArgs: [],
      });
    }
  });

  it('does not preserve fresh mutable authority in persisted respawn or marker recovery', () => {
    const descriptor = buildSessionRunnerRespawnDescriptorV1FromSpawnOptions({ directory: '/work', initialAccess, primaryTeamId: 'team-a' });
    expect(descriptor).not.toBeNull();
    if (!descriptor) throw new Error('Expected respawn descriptor');
    expect(descriptor).not.toHaveProperty('initialAccess');
    expect(descriptor).not.toHaveProperty('primaryTeamId');
    const recovered = buildSpawnSessionOptionsFromRespawnDescriptorV1(descriptor);
    expect(recovered).not.toHaveProperty('initialAccess');
    expect(recovered).not.toHaveProperty('primaryTeamId');
  });
});
