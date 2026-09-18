import { describe, expect, it } from 'vitest';

import { partitionProviderSessionArgs } from '@/cli/providerSessionArgPartition';
import { buildHappySessionControlArgs } from '@/daemon/sessionSpawnArgs';
import {
  buildSessionRunnerRespawnDescriptorV1FromSpawnOptions,
  buildSpawnSessionOptionsFromRespawnDescriptorV1,
} from '@/daemon/processSupervision/sessionRunnerRespawnDescriptor';
import { SpawnDaemonSessionRequestSchema } from './spawnSessionOptionsContract';

/**
 * An Agent mints its own resume id and is the only reader of it. Happier
 * carries the bytes; it does not canonicalize them.
 */
const OPAQUE_RESUME_ID = ' provider\nsession ';

describe('opaque Agent resume id preservation across the spawn corridor', () => {
  it('preserves the exact bytes through spawn request admission', () => {
    expect(SpawnDaemonSessionRequestSchema.parse({
      directory: '/work',
      resume: OPAQUE_RESUME_ID,
    }).resume).toBe(OPAQUE_RESUME_ID);
  });

  it('still rejects an absent or blank-only resume id at admission', () => {
    for (const resume of ['', '   ', ' \n\t ']) {
      expect(SpawnDaemonSessionRequestSchema.safeParse({ directory: '/work', resume }).success)
        .toBe(false);
    }
    expect(SpawnDaemonSessionRequestSchema.parse({ directory: '/work' }).resume).toBeUndefined();
  });

  it('preserves the exact bytes through the daemon-to-runner control argument handoff', () => {
    const args = buildHappySessionControlArgs({ resume: OPAQUE_RESUME_ID });

    expect(args).toEqual(['--resume', OPAQUE_RESUME_ID]);
    expect(partitionProviderSessionArgs({
      args: ['codex', '--started-by', 'daemon', ...args],
      providerSubcommand: 'codex',
    })).toMatchObject({ resume: OPAQUE_RESUME_ID, providerArgs: [] });
  });

  it('preserves the exact bytes through persisted respawn recovery', () => {
    const descriptor = buildSessionRunnerRespawnDescriptorV1FromSpawnOptions({
      directory: '/work',
      resume: OPAQUE_RESUME_ID,
    });
    expect(descriptor).not.toBeNull();
    if (!descriptor) throw new Error('Expected respawn descriptor');

    expect(descriptor.resume).toBe(OPAQUE_RESUME_ID);
    expect(buildSpawnSessionOptionsFromRespawnDescriptorV1(descriptor).resume)
      .toBe(OPAQUE_RESUME_ID);
  });

  it('still treats a blank-only resume id as absent in the control arguments and respawn descriptor', () => {
    expect(buildHappySessionControlArgs({ resume: '   ' })).toEqual([]);
    expect(buildSessionRunnerRespawnDescriptorV1FromSpawnOptions({
      directory: '/work',
      resume: '   ',
    })).not.toHaveProperty('resume');
  });
});
