import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createPersonalHomeBackupWithLease,
  type PersonalHomeBackupResult,
  type PersonalHomeSqliteMaintenance,
} from './backup.js';
import type { PersonalHomeRuntimeLayout } from './layout.js';
import {
  restorePersonalHomeBackupWithLease,
  type PersonalHomeRestoreHooks,
  type PersonalHomeRestoreResult,
} from './restore.js';

export type PersonalHomeRestorePoint = Readonly<{
  backup: PersonalHomeBackupResult;
  restore(hooks: PersonalHomeRestoreHooks): Promise<PersonalHomeRestoreResult>;
  dispose(): Promise<void>;
}>;

/**
 * Package-internal payload-lock → Home-lock seam. The caller must already own the Home lease;
 * this function deliberately does not acquire it again.
 */
export async function createPersonalHomeRestorePointWithLease(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  homeServerIdentityId: string;
  schemaVersion: string;
  happierVersion: string;
  configuration: Record<string, unknown>;
  sqlite: PersonalHomeSqliteMaintenance;
  readIdentityFromDatabase?(databasePath: string): Promise<Readonly<{ homeServerIdentityId: string }>>;
  operationLeaseHeld: true;
}>): Promise<PersonalHomeRestorePoint> {
  const id = randomUUID();
  const outputPath = join(params.layout.backupsDir, 'restore-points', `pre-upgrade-${id}.tar`);
  const stagingDir = join(dirname(params.layout.dataDir), `.personal-home-restore-point-${id}`);
  const backup = await createPersonalHomeBackupWithLease({
    ...params,
    outputPath,
    stagingDir,
    operationLeaseHeld: true,
  });
  return Object.freeze({
    backup,
    restore: (hooks) => restorePersonalHomeBackupWithLease({
      layout: params.layout,
      archivePath: backup.path,
      confirmOverwrite: true,
      expectedHomeServerIdentityId: params.homeServerIdentityId,
      isSchemaSupported: async (schemaVersion) => schemaVersion === params.schemaVersion,
      runMigrations: async () => undefined,
      ...(params.readIdentityFromDatabase ? { verifyStagedIdentity: async (databasePath: string, manifest: PersonalHomeRestoreResult['manifest']) => (await params.readIdentityFromDatabase!(databasePath)).homeServerIdentityId === manifest.homeServerIdentityId } : {}),
      ...hooks,
      operationLeaseHeld: true,
    }),
    dispose: () => rm(backup.path, { force: true }),
  });
}
