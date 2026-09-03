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
  const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-boot-admission-'));
  roots.push(homeDir);
  const layout = resolvePersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
  await mkdir(join(layout.dataDir, '.operations'), { recursive: true, mode: 0o700 });
  return layout;
}

function restoreJournal(
  layout: ReturnType<typeof resolvePersonalHomeRuntimeLayout>,
  phase: 'prepared' | 'activating' | 'completed',
) {
  const id = '11111111-1111-4111-8111-111111111111';
  const stage = `${layout.dataDir}.restore-stage-${process.pid}-${id}`;
  const promoted = phase === 'activating' || phase === 'completed';
  return {
    version: 2,
    phase,
    stage,
    wasRunning: false,
    ...(promoted
      ? {
          configurationRollbackArtifact: join(layout.configDir, `server.env.${id}.restore-rollback`),
          configurationRollbackState: 'pending',
        }
      : {}),
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
      hadTarget: promoted,
      state: promoted && index < 4 ? 'promoted' : 'untouched',
    })),
  };
}

async function writeOperationMarker(dataDir: string, name: string, value: unknown): Promise<void> {
  await writeFile(join(dataDir, '.operations', name), `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

describe('Personal Home direct-start admission', () => {
  it('admits a Personal Home with no interrupted operation state', async () => {
    const layout = await fixture();

    await expect(assertPersonalHomeBootAdmission(layout)).resolves.toBeUndefined();
  });

  it('blocks an interrupted restore before it reaches activation', async () => {
    const layout = await fixture();
    await writeOperationMarker(layout.dataDir, 'restore-journal.json', restoreJournal(layout, 'prepared'));

    await expect(assertPersonalHomeBootAdmission(layout)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_BOOT_ADMISSION_BLOCKED',
      reason: 'restore_recovery_required',
    });
  });

  it.each(['activating', 'completed'] as const)(
    'admits the canonical restore %s state needed to activate or finalize the verified Home',
    async (phase) => {
      const layout = await fixture();
      await writeOperationMarker(layout.dataDir, 'restore-journal.json', restoreJournal(layout, phase));

      await expect(assertPersonalHomeBootAdmission(layout)).resolves.toBeUndefined();
    },
  );

  it('blocks a quarantined relocation source', async () => {
    const layout = await fixture();
    const sourceDescriptor = {
      v: 1,
      homeServerIdentityId: 'srv_home_1',
      canonicalServerUrl: 'https://source.example.test',
      revision: 4,
      endpoints: [{ kind: 'https', url: 'https://source.example.test' }],
    };
    await writeOperationMarker(layout.dataDir, 'relocation-source.json', {
      version: 1,
      operationId: 'system-task:relocation-1',
      phase: 'source_quarantined',
      destinationMachineId: 'machine-b',
      bundleSha256: 'a'.repeat(64),
      homeServerIdentityId: 'srv_home_1',
      sourceCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 4,
      sourceDescriptor,
    });

    await expect(assertPersonalHomeBootAdmission(layout)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_BOOT_ADMISSION_BLOCKED',
      reason: 'relocation_source_blocked',
    });
  });

  it('blocks a staged relocation destination', async () => {
    const layout = await fixture();
    await writeOperationMarker(layout.dataDir, 'relocation-destination.json', {
      version: 1,
      operationId: 'system-task:relocation-1',
      status: 'receiving',
      bundleSha256: 'a'.repeat(64),
      expectedHomeServerIdentityId: 'srv_home_1',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 4,
    });

    await expect(assertPersonalHomeBootAdmission(layout)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_BOOT_ADMISSION_BLOCKED',
      reason: 'relocation_destination_blocked',
    });
  });
});
