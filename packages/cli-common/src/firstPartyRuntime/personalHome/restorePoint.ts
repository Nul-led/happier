import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createPersonalHomeBackupWithLease,
  type PersonalHomeSqliteMaintenance,
} from './backup.js';
import { verifyPersonalHomeArchive } from './archive.js';
import type { PersonalHomeBackupManifestV1 } from './manifest.js';
import type { PersonalHomeRuntimeLayout } from './layout.js';
import {
  finalizePersonalHomeRestoreWithLease,
  recoverPersonalHomeRestoreWithLease,
  restorePersonalHomeBackupWithLease,
  type PersonalHomeRestoreFinalizationResult,
  type PersonalHomeRestoreHooks,
  type PersonalHomeRestoreResult,
} from './restore.js';

export type PersonalHomeRestorePoint = Readonly<{
  backup: Readonly<{ path: string; manifest: PersonalHomeBackupManifestV1 }>;
  restore(hooks: PersonalHomeRestoreHooks): Promise<PersonalHomeRestoreResult>;
  recover(): Promise<Readonly<{ outcome: 'rolled_back' | 'recovery_required'; restartedHome: boolean; error?: string }>>;
  finalize(): Promise<PersonalHomeRestoreFinalizationResult>;
  dispose(): Promise<void>;
}>;

function createPersonalHomeRestorePointHandle(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  archivePath: string;
  manifest: PersonalHomeBackupManifestV1;
  expectedHomeServerIdentityId: string;
  schemaVersion: string;
  readIdentityFromDatabase?(databasePath: string): Promise<Readonly<{ homeServerIdentityId: string }>>;
  readDataCountsFromDatabase(databasePath: string): Promise<Readonly<{ accountCount: number; sessionCount: number }>>;
  finalizeConfiguration(rollbackArtifact: string): Promise<void>;
  recoverConfiguration(rollbackArtifact: string): Promise<void>;
}>): PersonalHomeRestorePoint {
  return Object.freeze({
    backup: Object.freeze({ path: params.archivePath, manifest: params.manifest }),
    restore: (hooks) => restorePersonalHomeBackupWithLease({
      layout: params.layout,
      archivePath: params.archivePath,
      confirmOverwrite: true,
      expectedHomeServerIdentityId: params.expectedHomeServerIdentityId,
      isSchemaSupported: async (schemaVersion) => schemaVersion === params.schemaVersion,
      runMigrations: async () => undefined,
      ...(params.readIdentityFromDatabase ? { verifyStagedIdentity: async (databasePath: string, manifest: PersonalHomeRestoreResult['manifest']) => (await params.readIdentityFromDatabase!(databasePath)).homeServerIdentityId === manifest.homeServerIdentityId } : {}),
      ...hooks,
      readDataCountsFromDatabase: params.readDataCountsFromDatabase,
      requireDataCountVerification: true,
      operationLeaseHeld: true,
    }),
    recover: () => recoverPersonalHomeRestoreWithLease({
      layout: params.layout,
      operationLeaseHeld: true,
      isHomeRunning: async () => false,
      stopHome: async () => undefined,
      startHome: async () => undefined,
      healthCheck: async () => true,
      recoverConfiguration: params.recoverConfiguration,
    }),
    finalize: () => finalizePersonalHomeRestoreWithLease({
      layout: params.layout,
      operationLeaseHeld: true,
      finalizeConfiguration: params.finalizeConfiguration,
    }),
    dispose: () => rm(params.archivePath, { force: true }),
  });
}

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
  readDataCountsFromDatabase(databasePath: string): Promise<Readonly<{ accountCount: number; sessionCount: number }>>;
  finalizeConfiguration(rollbackArtifact: string): Promise<void>;
  recoverConfiguration(rollbackArtifact: string): Promise<void>;
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
  return createPersonalHomeRestorePointHandle({
    layout: params.layout,
    archivePath: backup.path,
    manifest: backup.manifest,
    expectedHomeServerIdentityId: params.homeServerIdentityId,
    schemaVersion: params.schemaVersion,
    ...(params.readIdentityFromDatabase ? { readIdentityFromDatabase: params.readIdentityFromDatabase } : {}),
    readDataCountsFromDatabase: params.readDataCountsFromDatabase,
    finalizeConfiguration: params.finalizeConfiguration,
    recoverConfiguration: params.recoverConfiguration,
  });
}

/** Reopens the exact canonical pre-upgrade archive after a process interruption. */
export async function openPersonalHomeRestorePointWithLease(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  archivePath: string;
  expectedHomeServerIdentityId: string;
  schemaVersion: string;
  readIdentityFromDatabase?(databasePath: string): Promise<Readonly<{ homeServerIdentityId: string }>>;
  readDataCountsFromDatabase(databasePath: string): Promise<Readonly<{ accountCount: number; sessionCount: number }>>;
  finalizeConfiguration(rollbackArtifact: string): Promise<void>;
  recoverConfiguration(rollbackArtifact: string): Promise<void>;
  operationLeaseHeld: true;
}>): Promise<PersonalHomeRestorePoint> {
  const manifest = await verifyPersonalHomeArchive(params.archivePath);
  if (manifest.homeServerIdentityId !== params.expectedHomeServerIdentityId || manifest.schemaVersion !== params.schemaVersion) {
    throw new Error('Personal Home update restore point identity or schema does not match its recovery record');
  }
  return createPersonalHomeRestorePointHandle({
    layout: params.layout,
    archivePath: params.archivePath,
    manifest,
    expectedHomeServerIdentityId: params.expectedHomeServerIdentityId,
    schemaVersion: params.schemaVersion,
    ...(params.readIdentityFromDatabase ? { readIdentityFromDatabase: params.readIdentityFromDatabase } : {}),
    readDataCountsFromDatabase: params.readDataCountsFromDatabase,
    finalizeConfiguration: params.finalizeConfiguration,
    recoverConfiguration: params.recoverConfiguration,
  });
}
