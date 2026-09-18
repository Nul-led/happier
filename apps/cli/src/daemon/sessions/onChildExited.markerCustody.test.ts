import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

let temporaryHome: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true });
});

it('preserves marker evidence when an exit notification has no tracked custody', async () => {
  temporaryHome = await mkdtemp(join(tmpdir(), 'happier-untracked-exit-'));
  vi.stubEnv('HAPPIER_HOME_DIR', temporaryHome);
  vi.resetModules();
  const { writeSessionMarker, listSessionMarkers, removeSessionMarker } = await import('../sessionRegistry');
  const { createOnChildExited } = await import('./onChildExited');
  const pid = 54321;
  await writeSessionMarker({ pid, happySessionId: 'retained-session', startedBy: 'terminal', cwd: temporaryHome });
  const removals: Promise<void>[] = [];
  const onChildExited = createOnChildExited({
    pidToTrackedSession: new Map(),
    spawnResourceCleanupByPid: new Map(),
    sessionAttachCleanupByPid: new Map(),
    getApiMachineForSessions: () => null,
    removeSessionMarkerFn: (markerPid) => {
      // Observe completion without replacing the real marker persistence owner.
      const removal = removeSessionMarker(markerPid);
      removals.push(removal);
      return removal;
    },
  });

  await onChildExited(pid, { reason: 'process-missing', code: null, signal: null });
  await Promise.all(removals);

  expect(await listSessionMarkers()).toEqual([
    expect.objectContaining({ pid, happySessionId: 'retained-session' }),
  ]);
});

