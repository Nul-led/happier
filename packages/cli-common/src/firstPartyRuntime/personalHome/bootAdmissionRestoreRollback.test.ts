import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assertPersonalHomeBootAdmission } from './bootAdmission.js';
import { resolvePersonalHomeRuntimeLayout } from './layout.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-boot-rollback-'));
  roots.push(homeDir);
  const layout = resolvePersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
  await mkdir(join(layout.dataDir, '.operations'), { recursive: true, mode: 0o700 });
  return layout;
}

/** A journal exactly as the canonical restore owner persists it when a rollback
 * has fully applied and it restarts the previous Home before unlinking the
 * journal (restore failure path and recoverPersonalHomeRestoreWithLease). */
function fullyRolledBackJournal(layout: ReturnType<typeof resolvePersonalHomeRuntimeLayout>) {
  const id = '22222222-2222-4222-8222-222222222222';
  const stage = `${layout.dataDir}.restore-stage-${process.pid}-${id}`;
  return {
    version: 2,
    phase: 'rolling_back',
    stage,
    wasRunning: true,
    entries: [
      [layout.databasePath, join(stage, 'database/home.sqlite')],
      [layout.publicFilesDir, join(stage, 'files/public')],
      [layout.privateFilesDir, join(stage, 'files/private')],
      [layout.masterSecretPath, join(stage, 'secrets/handy-master-secret.txt')],
      [layout.derivedDataDir, join(stage, 'derived')],
    ].map(([target, source], index) => ({
      target,
      source,
      rollback: `${target}.restore-rollback-${id}`,
      hadTarget: index < 4,
      state: index < 4 ? 'rollback_applied' : 'untouched',
    })),
  };
}

async function writeJournal(dataDir: string, journal: unknown): Promise<void> {
  await writeFile(join(dataDir, '.operations', 'restore-journal.json'), `${JSON.stringify(journal)}\n`, { mode: 0o600 });
}

describe('Personal Home boot admission for restore rollback restarts', () => {
  it('admits the fully rolled-back journal the canonical owner restarts the Home through', async () => {
    const layout = await fixture();
    await writeJournal(layout.dataDir, fullyRolledBackJournal(layout));

    await expect(assertPersonalHomeBootAdmission(layout)).resolves.toBeUndefined();
  });

  it('blocks an interrupted rollback whose entries are only partially rolled back', async () => {
    const layout = await fixture();
    const journal = fullyRolledBackJournal(layout) as { entries: Array<Record<string, unknown>> };
    journal.entries[0] = { ...journal.entries[0]!, state: 'rollback_started' };
    await writeJournal(layout.dataDir, journal);

    await expect(assertPersonalHomeBootAdmission(layout)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_BOOT_ADMISSION_BLOCKED',
      reason: 'restore_recovery_required',
    });
  });
});
