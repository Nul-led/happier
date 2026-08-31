import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

import { verifyPersonalHomeArchive } from './archive.js';
import {
  createPersonalHomeBackupWithLease,
  listPersonalHomeBackupArchives,
  type PersonalHomeBackupResult,
  type PersonalHomeSqliteMaintenance,
} from './backup.js';
import { erasePersonalHomeData, PersonalHomeEraseError, resolvePersonalHomeEraseTargets } from './erase.js';
import type { PersonalHomeRuntimeLayout } from './layout.js';
import type { PersonalHomeRestorableConfigurationV1 } from './configuration.js';
import { withPersonalHomeOperationLock } from './lock.js';
import { fingerprintMasterSecret, type PersonalHomeBackupManifestV1 } from './manifest.js';
import type { ManagedRelayPurpose } from './personalHomeRuntimeSpec.js';
import {
  relocatePersonalHome,
  type PersonalHomeBundleTransfer,
  type PersonalHomeRelocationResult,
} from './relocation.js';
import {
  inspectPersonalHomeRestoreRecovery,
  finalizePersonalHomeRestoreWithLease,
  hasMeaningfulPersonalHomeData,
  recoverPersonalHomeRestoreWithLease,
  restorePersonalHomeBackupWithLease,
  type PersonalHomeRestoreRecoveryFacts,
  type PersonalHomeRestoreRecoveryResult,
  type PersonalHomeRestoreFinalizationResult,
  type PersonalHomeRestoreResult,
} from './restore.js';

export type PersonalHomeBackupOperationResult = PersonalHomeBackupResult;
export type PersonalHomeRestoreOperationResult = PersonalHomeRestoreResult;
export type PersonalHomeRelocateOperationResult = PersonalHomeRelocationResult;

/**
 * Typed result facts read from the Home identity/config owner (server identity seam). Never
 * contains secret material — callers fingerprint secrets through the dedicated result fields.
 */
export type PersonalHomeIdentityFacts = Readonly<{
  homeServerIdentityId: string;
  schemaVersion: string;
}>;

export class PersonalHomeOperationsError extends Error {
  constructor(
    public readonly code:
      | 'purpose_not_personal_home'
      | 'identity_unavailable'
      | 'sqlite_maintenance_required'
      | 'home_stop_failed'
      | 'operation_cancelled'
      | 'restore_unavailable'
      | 'restore_recovery_required'
      | 'relocation_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'PersonalHomeOperationsError';
  }
}

/**
 * Explicit real-system boundaries. The facade owns operation dispatch, purpose/identity
 * enforcement, and the single lifecycle wiring point; every boundary is supplied by the
 * existing owners (layout resolver, relayHostEngine/relayRuntimeInstall lifecycle, SQLite
 * maintenance, server identity/config reader, derived search lifecycle).
 */
export type PersonalHomeOperationsDeps = Readonly<{
  /** Managed runtime purpose reader; only the `personal-home` purpose is served here. */
  readPurpose(): Promise<ManagedRelayPurpose>;
  /** Home identity/config reader; may fail while the Home is uninitialized. */
  readIdentity(layout: PersonalHomeRuntimeLayout): Promise<PersonalHomeIdentityFacts>;
  /** Lane 03 canonical `PersonalHomeRuntimeLayout` resolver — the only path authority. */
  resolveLayout(): Promise<PersonalHomeRuntimeLayout>;
  /** Runtime owner attestation; ambient environment values alone never authorize deletion. */
  validateLayout(layout: PersonalHomeRuntimeLayout): Promise<void>;
  /** Service lifecycle seam (stop/start/health) from the existing runtime engine. */
  lifecycle: Readonly<{
    isRunning(): Promise<boolean>;
    stop(): Promise<void>;
    start(): Promise<void>;
    healthCheck?(): Promise<boolean>;
  }>;
  /** SQLite maintenance for one database (offline TRUNCATE checkpoint + quick_check). */
  sqliteMaintenance(databasePath: string): Promise<PersonalHomeSqliteMaintenance>;
  migrateStagedDatabase?(layout: PersonalHomeRuntimeLayout, databasePath: string, manifest: PersonalHomeBackupManifestV1): Promise<void>;
  readIdentityFromDatabase?(layout: PersonalHomeRuntimeLayout, databasePath: string): Promise<PersonalHomeIdentityFacts>;
  /** Fixed sanitized configuration allowlist reader — never a raw environment dump. */
  readConfiguration(layout: PersonalHomeRuntimeLayout): Promise<Record<string, unknown>>;
  /** Canonical `configDir/server.env` owner with a durable rollback artifact. */
  prepareConfiguration(layout: PersonalHomeRuntimeLayout, configuration: PersonalHomeRestorableConfigurationV1): Promise<Readonly<{
    rollbackArtifact: string;
    apply(): Promise<void>;
    rollback(): Promise<void>;
  }>>;
  inspectConfigurationStorage?(layout: PersonalHomeRuntimeLayout, configuration: PersonalHomeRestorableConfigurationV1): Promise<Readonly<{ targetPath: string; incomingBytes: number; rollbackBytes: number }>>;
  recoverConfiguration(layout: PersonalHomeRuntimeLayout, rollbackArtifact: string): Promise<void>;
  finalizeConfiguration?(layout: PersonalHomeRuntimeLayout, rollbackArtifact: string): Promise<void>;
  /** Fresh runtime version recorded in backup manifests. */
  readHappierVersion?(): Promise<string>;
  /** Transitional direct-owner test compatibility; canonical production factory uses reader. */
  happierVersion?: string;
  /** Installed migration metadata owner; callers cannot guess ordering from migration names. */
  isSchemaSupported?(layout: PersonalHomeRuntimeLayout, schemaVersion: string): Promise<boolean>;
  /** Destination/carrier/publication boundary resolved once by production composition. */
  relocation?: Readonly<{
    transfer: PersonalHomeBundleTransfer;
    prepareDestination(input: Readonly<{ dataDir: string }>): Promise<void>;
    restoreDestinationWithLease(input: Readonly<{ dataDir: string; archivePath: string; operationLeaseHeld: true }>): Promise<void>;
    verifyDestination(input: Readonly<{ dataDir: string }>): Promise<Readonly<{ homeServerIdentityId: string }>>;
    startDestination(input: Readonly<{ dataDir: string }>): Promise<Readonly<{ healthy: boolean; homeServerIdentityId: string }>>;
    stopDestination(input: Readonly<{ dataDir: string }>): Promise<void>;
    quarantineDestination(input: Readonly<{ dataDir: string }>): Promise<void>;
    commitSameHomeRelocation(input: PersonalHomeRelocationCommit): Promise<void>;
  }>;
}>;

export type PersonalHomeInspection = Readonly<{
  purpose: 'personal-home';
  canonicalServerUrl: string;
  layout: PersonalHomeRuntimeLayout;
  running: boolean;
  identity: PersonalHomeIdentityFacts | null;
  masterSecret: Readonly<{ present: boolean; fingerprint: string | null }>;
  storage: Readonly<{
    databasePresent: boolean;
    databaseBytes: number | null;
    publicFilesPresent: boolean;
    privateFilesPresent: boolean;
    backupsCount: number;
    latestBackup: Readonly<{ path: string; createdAt: string; archiveBytes: number }> | null;
    ownedErasePaths: readonly string[];
    estimatedOwnedBytes: number | null;
    destinationEmpty: boolean;
  }>;
  restoreRecovery: PersonalHomeRestoreRecoveryFacts;
}>;

export type PersonalHomeBackupOperationInput = Readonly<{
  outputPath?: string;
  intent?: 'standard' | 'erase-safety';
} & PersonalHomeOperationContext>;

export type PersonalHomeOperationContext = Readonly<{
  signal?: AbortSignal;
  progress?(stepId: string, message?: string): void;
  /** Task-origin purpose binding; rejects a Home switch between request and execution. */
  expectedCanonicalServerUrl?: string;
}>;

export type PersonalHomeBackupVerification = Readonly<{
  manifest: PersonalHomeBackupManifestV1;
  identityMatchesCurrentHome: 'match' | 'mismatch' | 'unknown';
}>;

export type PersonalHomeRestoreOperationInput = Readonly<{
  archivePath: string;
  /** Required to replace a destination that already contains meaningful Home data. */
  confirmOverwrite?: boolean;
  /** Expected destination identity; defaults to the current Home identity when readable. */
  expectedHomeServerIdentityId?: string;
} & PersonalHomeOperationContext>;

export type PersonalHomeEraseConfirmationFacts = Readonly<{
  canonicalServerUrl: string;
  homeServerIdentityId: string | null;
  paths: readonly string[];
  estimatedBytes: number | null;
}>;

export function createPersonalHomeEraseConfirmationToken(facts: PersonalHomeEraseConfirmationFacts): string {
  const payload = JSON.stringify({
    v: 1,
    canonicalServerUrl: facts.canonicalServerUrl,
    homeServerIdentityId: facts.homeServerIdentityId,
    paths: [...facts.paths].sort(),
    estimatedBytes: facts.estimatedBytes,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export type PersonalHomeEraseOperationInput = Readonly<{
  confirm(facts: PersonalHomeEraseConfirmationFacts): Promise<boolean>;
} & PersonalHomeOperationContext>;

export type PersonalHomeEraseOperationResult = Readonly<{
  removedPaths: readonly string[];
  remainingUnknownPaths: readonly string[];
  stoppedRunningHome: boolean;
}>;

/** Facade-owned publication seam using the canonical server identity vocabulary. */
export type PersonalHomeRelocationCommit = Readonly<{
  homeServerIdentityId: string;
  newConnectionDescriptor: HomeConnectionDescriptorV1;
}>;

export type PersonalHomeRelocateInput = Readonly<{
  destinationDataDir: string;
  destinationDescriptor: HomeConnectionDescriptorV1;
  publicIntegrationsNeedAttention?: readonly string[];
  followerAction?: 'none' | 'reconnect' | 'reenroll';
} & PersonalHomeOperationContext>;

export type PersonalHomeOperations = Readonly<{
  inspect(context?: PersonalHomeOperationContext): Promise<PersonalHomeInspection>;
  backup(input?: PersonalHomeBackupOperationInput): Promise<PersonalHomeBackupResult>;
  verifyBackup(input: Readonly<{ archivePath: string } & PersonalHomeOperationContext>): Promise<PersonalHomeBackupVerification>;
  restore(input: PersonalHomeRestoreOperationInput): Promise<PersonalHomeRestoreResult>;
  erase(input: PersonalHomeEraseOperationInput): Promise<PersonalHomeEraseOperationResult>;
  recoverRestore(input?: PersonalHomeOperationContext): Promise<PersonalHomeRestoreRecoveryResult>;
  finalizeRestore(input?: PersonalHomeOperationContext): Promise<PersonalHomeRestoreFinalizationResult>;
  relocate(input: PersonalHomeRelocateInput): Promise<PersonalHomeRelocationResult>;
}>;

type PersonalHomePurpose = Extract<ManagedRelayPurpose, { kind: 'personal-home' }>;

function assertPersonalHomePurpose(purpose: ManagedRelayPurpose): asserts purpose is PersonalHomePurpose {
  if (purpose.kind !== 'personal-home') {
    throw new PersonalHomeOperationsError(
      'purpose_not_personal_home',
      'Personal Home operations only serve the personal-home managed runtime purpose.',
    );
  }
}

function assertExpectedPurpose(purpose: PersonalHomePurpose, context: PersonalHomeOperationContext): void {
  if (context.expectedCanonicalServerUrl !== undefined && purpose.canonicalServerUrl !== context.expectedCanonicalServerUrl) {
    throw new PersonalHomeOperationsError('purpose_not_personal_home', 'Personal Home purpose changed before the operation began.');
  }
}

async function fileSizeOrNull(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function estimateOwnedBytes(paths: readonly string[]): Promise<number | null> {
  const visit = async (path: string): Promise<number> => { const info = await lstat(path); if (info.isSymbolicLink()) throw new Error('symbolic link'); if (info.isFile()) return info.size; if (!info.isDirectory()) return 0; let total = 0; for (const name of await readdir(path)) total += await visit(join(path, name)); return total; };
  let total = 0;
  try { for (const path of paths) total += await visit(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? 0 : Promise.reject(error)); return total; } catch { return null; }
}

/**
 * Single operation/lifecycle owner for Personal Home data operations. Every production backup,
 * verify, restore, erase, and relocate request must flow through this facade so that exactly one
 * data-operation lock (lock.ts) and one lifecycle wiring point are used. Runtime/install
 * separation is preserved by construction: uninstall is not offered here, and erase is a
 * separately confirmed destructive operation that nothing calls implicitly.
 */
export function createPersonalHomeOperations(deps: PersonalHomeOperationsDeps): PersonalHomeOperations {
  if (typeof deps.sqliteMaintenance !== 'function') {
    throw new PersonalHomeOperationsError(
      'sqlite_maintenance_required',
      'Personal Home operations require a SQLite maintenance boundary; production backups must never copy an unchecked live database.',
    );
  }
  const healthCheck = deps.lifecycle.healthCheck;
  const readHappierVersion = async (): Promise<string> => deps.readHappierVersion ? deps.readHappierVersion() : deps.happierVersion ?? 'unknown';
  const checkCancelled = (context: PersonalHomeOperationContext): void => {
    if (context.signal?.aborted) throw new PersonalHomeOperationsError('operation_cancelled', 'Personal Home operation was cancelled before mutation.');
  };
  const withStableLayoutLease = async <T>(kind: 'inspect' | 'backup' | 'verify_backup' | 'restore' | 'erase', context: PersonalHomeOperationContext, fn: (layout: PersonalHomeRuntimeLayout, purpose: PersonalHomePurpose) => Promise<T>): Promise<T> => {
    checkCancelled(context);
    const initialPurpose = await deps.readPurpose(); assertPersonalHomePurpose(initialPurpose); assertExpectedPurpose(initialPurpose, context);
    const initialLayout = await deps.resolveLayout(); await deps.validateLayout(initialLayout);
    return withPersonalHomeOperationLock(initialLayout.dataDir, kind, async () => {
      checkCancelled(context);
      const currentPurpose = await deps.readPurpose(); assertPersonalHomePurpose(currentPurpose); assertExpectedPurpose(currentPurpose, context);
      const currentLayout = await deps.resolveLayout(); await deps.validateLayout(currentLayout);
      if (JSON.stringify(currentLayout) !== JSON.stringify(initialLayout) || currentPurpose.canonicalServerUrl !== initialPurpose.canonicalServerUrl) throw new PersonalHomeOperationsError('purpose_not_personal_home', 'Personal Home purpose or canonical layout changed while waiting for the operation lease.');
      return fn(initialLayout, currentPurpose);
    });
  };

  const requireIdentity = async (layout: PersonalHomeRuntimeLayout): Promise<PersonalHomeIdentityFacts> => {
    try {
      return await deps.readIdentity(layout);
    } catch (error) {
      throw new PersonalHomeOperationsError(
        'identity_unavailable',
        `Personal Home identity is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const readIdentityOrNull = async (layout: PersonalHomeRuntimeLayout): Promise<PersonalHomeIdentityFacts | null> => {
    try {
      return await deps.readIdentity(layout);
    } catch {
      return null;
    }
  };

  const readMasterSecretFacts = async (layout: PersonalHomeRuntimeLayout) => {
    try {
      const bytes = await readFile(layout.masterSecretPath);
      return { present: true, fingerprint: fingerprintMasterSecret(bytes) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { present: false, fingerprint: null };
      throw error;
    }
  };

  const inspect = async (context: PersonalHomeOperationContext = {}): Promise<PersonalHomeInspection> => {
    context.progress?.('acquiring_lock');
    return withStableLayoutLease('inspect', context, async (layout, purpose) => {
      context.progress?.('inspecting');
      const ownedErasePaths = resolvePersonalHomeEraseTargets(layout);
      const [identity, masterSecret, running, databaseBytes, publicFilesPresent, privateFilesPresent, backupArchives, restoreRecovery, estimatedOwnedBytes, destinationHasData] =
      await Promise.all([
        readIdentityOrNull(layout),
        readMasterSecretFacts(layout),
        deps.lifecycle.isRunning(),
        fileSizeOrNull(layout.databasePath),
        isDirectory(layout.publicFilesDir),
        isDirectory(layout.privateFilesDir),
        listPersonalHomeBackupArchives(layout.backupsDir),
        inspectPersonalHomeRestoreRecovery(layout),
        estimateOwnedBytes(ownedErasePaths),
        hasMeaningfulPersonalHomeData(layout),
      ]);
      return {
      purpose: 'personal-home',
      canonicalServerUrl: purpose.canonicalServerUrl,
      layout,
      running,
      identity,
      masterSecret,
      storage: { databasePresent: databaseBytes !== null, databaseBytes, publicFilesPresent, privateFilesPresent, backupsCount: backupArchives.length, latestBackup: backupArchives[0] ?? null, ownedErasePaths, estimatedOwnedBytes, destinationEmpty: !destinationHasData },
      restoreRecovery,
      };
    });
  };

  const backup = async (input: PersonalHomeBackupOperationInput = {}): Promise<PersonalHomeBackupResult> => {
    input.progress?.('inspecting');
    return withStableLayoutLease('backup', input, async (layout) => {
      const identity = await requireIdentity(layout);
      const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
      const outputPath = input.outputPath ?? join(layout.backupsDir, `personal-home-${timestamp}.tar`);
      if (input.intent === 'erase-safety') {
        if (!input.outputPath) {
          throw new PersonalHomeEraseError('unsafe_data_root', 'A pre-erase safety backup requires an explicit output path.');
        }
        const resolvedOutput = resolve(outputPath);
        const protectedRoots = [layout.dataDir, layout.configDir, layout.backupsDir, ...resolvePersonalHomeEraseTargets(layout)];
        const isInsideProtectedRoot = protectedRoots.some((root) => {
          const pathFromRoot = relative(resolve(root), resolvedOutput);
          return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(pathFromRoot));
        });
        if (isInsideProtectedRoot) {
          throw new PersonalHomeEraseError('unsafe_data_root', 'The pre-erase safety backup must be outside Personal Home data, backups, configuration, and every erase target.');
        }
      }
      const stagingDir = join(dirname(layout.dataDir), `.personal-home-backup-${process.pid}-${randomUUID()}`);
      const wasRunning = await deps.lifecycle.isRunning();
      let homeNeedsAttention = false;
      let result: PersonalHomeBackupResult | undefined;
      try {
        if (wasRunning) {
          checkCancelled(input);
          input.progress?.('stopping_home');
          await deps.lifecycle.stop();
          if (await deps.lifecycle.isRunning()) throw new PersonalHomeOperationsError('home_stop_failed', 'Personal Home did not stop; backup was not attempted.');
        }
        const maintenance = await deps.sqliteMaintenance(layout.databasePath);
        result = await createPersonalHomeBackupWithLease({
        layout,
        outputPath,
        stagingDir,
        homeServerIdentityId: identity.homeServerIdentityId,
        schemaVersion: identity.schemaVersion,
        happierVersion: await readHappierVersion(),
        configuration: await deps.readConfiguration(layout),
        sqlite: {
          checkpoint: async () => { input.progress?.('checkpointing'); return maintenance.checkpoint(); },
          quickCheck: async () => { input.progress?.('validating_database'); return maintenance.quickCheck(); },
          close: () => maintenance.close(),
        },
        operationLeaseHeld: true,
        });
      } finally {
        if (wasRunning) {
          input.progress?.('restarting_home');
          try {
            await deps.lifecycle.start();
            if (healthCheck && !(await healthCheck())) homeNeedsAttention = true;
          } catch {
            homeNeedsAttention = true;
          }
        }
      }
      if (!result) throw new Error('Personal Home backup did not produce a result');
      return homeNeedsAttention ? { ...result, homeNeedsAttention: true } : result;
    });
  };

  const verifyBackup = async (input: Readonly<{ archivePath: string } & PersonalHomeOperationContext>): Promise<PersonalHomeBackupVerification> => {
    return withStableLayoutLease('verify_backup', input, async (layout) => {
      input.progress?.('verifying_archive');
      const manifest = await verifyPersonalHomeArchive(input.archivePath);
      const identity = await readIdentityOrNull(layout);
      return {
      manifest,
      identityMatchesCurrentHome: identity === null
        ? 'unknown'
        : identity.homeServerIdentityId === manifest.homeServerIdentityId ? 'match' : 'mismatch',
      };
    });
  };

  const restore = async (input: PersonalHomeRestoreOperationInput): Promise<PersonalHomeRestoreResult> => {
    input.progress?.('validating_archive');
    return withStableLayoutLease('restore', input, async (layout) => {
      if (!deps.isSchemaSupported || !deps.migrateStagedDatabase || !deps.readIdentityFromDatabase || !deps.inspectConfigurationStorage) throw new PersonalHomeOperationsError('restore_unavailable', 'Personal Home restore schema, migration, identity, and configuration storage owners are unavailable.');
      const destinationHasData = await hasMeaningfulPersonalHomeData(layout);
      const identity = await readIdentityOrNull(layout);
      if (destinationHasData && !identity) {
        throw new PersonalHomeOperationsError('identity_unavailable', 'Existing Personal Home data cannot be restored because its stored identity is unavailable.');
      }
      const expectedHomeServerIdentityId = identity?.homeServerIdentityId
        ?? (destinationHasData ? undefined : input.expectedHomeServerIdentityId);
      return restorePersonalHomeBackupWithLease({
      layout,
      operationLeaseHeld: true,
      archivePath: input.archivePath,
      ...(expectedHomeServerIdentityId
        ? { expectedHomeServerIdentityId }
        : {}),
      isSchemaSupported: (schemaVersion: string) => deps.isSchemaSupported!(layout, schemaVersion),
      confirmOverwrite: input.confirmOverwrite === true,
      stopHome: async () => { input.progress?.('stopping_home'); await deps.lifecycle.stop(); },
      startHome: async () => { input.progress?.('starting_home'); await deps.lifecycle.start(); },
      ...(healthCheck ? { healthCheck: async () => { input.progress?.('health_check'); return healthCheck(); } } : {}),
      isHomeRunning: () => deps.lifecycle.isRunning(),
      checkCancelledBeforeMutation: () => checkCancelled(input),
      sqliteMaintenance: (databasePath: string) => deps.sqliteMaintenance(databasePath),
      runMigrations: (databasePath, manifest) => deps.migrateStagedDatabase!(layout, databasePath, manifest),
      verifyStagedIdentity: async (databasePath, manifest) => (await deps.readIdentityFromDatabase!(layout, databasePath)).homeServerIdentityId === manifest.homeServerIdentityId,
      prepareConfiguration: (configuration) => deps.prepareConfiguration(layout, configuration),
      inspectConfigurationStorage: (configuration) => deps.inspectConfigurationStorage!(layout, configuration),
      verifyIdentity: async (manifest: PersonalHomeBackupManifestV1) =>
        (await deps.readIdentity(layout)).homeServerIdentityId === manifest.homeServerIdentityId,
      });
    });
  };

  const recoverRestore = async (input: PersonalHomeOperationContext = {}): Promise<PersonalHomeRestoreRecoveryResult> => {
    return withStableLayoutLease('restore', input, async (layout) => {
      input.progress?.('recovering_restore');
      return recoverPersonalHomeRestoreWithLease({
        layout,
        operationLeaseHeld: true,
        isHomeRunning: () => deps.lifecycle.isRunning(),
        stopHome: () => deps.lifecycle.stop(),
        startHome: () => deps.lifecycle.start(),
        healthCheck: healthCheck ?? (async () => false),
        recoverConfiguration: (artifact) => deps.recoverConfiguration(layout, artifact),
      });
    });
  };

  const finalizeRestore = async (input: PersonalHomeOperationContext = {}): Promise<PersonalHomeRestoreFinalizationResult> => {
    return withStableLayoutLease('restore', input, async (layout) => {
      if (!deps.finalizeConfiguration) throw new PersonalHomeOperationsError('restore_unavailable', 'Personal Home restore finalization owner is unavailable.');
      input.progress?.('finalizing_restore');
      return finalizePersonalHomeRestoreWithLease({
        layout,
        operationLeaseHeld: true,
        finalizeConfiguration: (artifact) => deps.finalizeConfiguration!(layout, artifact),
      });
    });
  };

  const erase = async (input: PersonalHomeEraseOperationInput): Promise<PersonalHomeEraseOperationResult> => {
    input.progress?.('acquiring_lock');
    // The erase owner is the facade: erasePersonalHomeData does not take the common lock itself,
    // so the lock is acquired here and the Home is stopped under it before any deletion.
    return withStableLayoutLease('erase', input, async (layout, purpose) => {
      let restoreRecovery: PersonalHomeRestoreRecoveryFacts;
      try {
        restoreRecovery = await inspectPersonalHomeRestoreRecovery(layout);
      } catch {
        throw new PersonalHomeOperationsError(
          'restore_recovery_required',
          'Personal Home restore state is ambiguous; recover, roll back, or finalize the restore before erasing data.',
        );
      }
      if (restoreRecovery.status !== 'none') {
        throw new PersonalHomeOperationsError(
          'restore_recovery_required',
          'Personal Home restore recovery or finalization is required before erasing data.',
        );
      }
      const wasRunning = await deps.lifecycle.isRunning();
      if (wasRunning) {
        input.progress?.('stopping_home');
        try {
          await deps.lifecycle.stop();
          if (await deps.lifecycle.isRunning()) {
            throw new PersonalHomeOperationsError('home_stop_failed', 'Personal Home did not stop; erase was not attempted.');
          }
        } catch (error) {
          await deps.lifecycle.start().catch(() => undefined);
          throw error;
        }
      }
      const paths = resolvePersonalHomeEraseTargets(layout);
      const estimatedBytes = await estimateOwnedBytes(paths);
      const identity = await readIdentityOrNull(layout);
      try {
        checkCancelled(input);
        input.progress?.('awaiting_confirmation');
        if (!await input.confirm({
          canonicalServerUrl: purpose.canonicalServerUrl,
          homeServerIdentityId: identity?.homeServerIdentityId ?? null,
          paths,
          estimatedBytes,
        })) {
          throw new PersonalHomeEraseError(
            'confirmation_required',
            'Personal Home data deletion was not explicitly confirmed.',
          );
        }
        checkCancelled(input);
      } catch (error) {
        if (wasRunning) await deps.lifecycle.start().catch(() => undefined);
        throw error;
      }
      input.progress?.('erasing');
      const result = await erasePersonalHomeData({ layout, operationLeaseHeld: true });
      return { removedPaths: result.removedPaths, remainingUnknownPaths: result.remainingUnknownPaths, stoppedRunningHome: wasRunning };
    });
  };

  const relocate = async (input: PersonalHomeRelocateInput): Promise<PersonalHomeRelocationResult> => {
    checkCancelled(input);
    input.progress?.('preflight');
    const purpose = await deps.readPurpose(); assertPersonalHomePurpose(purpose); assertExpectedPurpose(purpose, input);
    const layout = await deps.resolveLayout();
    await deps.validateLayout(layout);
    const identity = await requireIdentity(layout);
    const adapter = deps.relocation;
    if (!adapter) throw new PersonalHomeOperationsError('relocation_unavailable', 'Personal Home relocation is unavailable.');
    // relocatePersonalHome owns the ordered dual-Home locks and the deterministic phase machine;
    // the source lifecycle is wired to this facade's lifecycle boundary and the publication
    // callback receives the identity under its canonical homeServerIdentityId name.
    return relocatePersonalHome({
      source: { dataDir: layout.dataDir, homeServerIdentityId: identity.homeServerIdentityId },
      destination: { dataDir: input.destinationDataDir },
      revalidateSourceUnderLocks: async () => {
        checkCancelled(input);
        const currentPurpose = await deps.readPurpose();
        assertPersonalHomePurpose(currentPurpose);
        assertExpectedPurpose(currentPurpose, input);
        const currentLayout = await deps.resolveLayout();
        await deps.validateLayout(currentLayout);
        const currentIdentity = await requireIdentity(currentLayout);
        if (
          currentPurpose.canonicalServerUrl !== purpose.canonicalServerUrl
          || JSON.stringify(currentLayout) !== JSON.stringify(layout)
          || JSON.stringify(currentIdentity) !== JSON.stringify(identity)
        ) {
          throw new PersonalHomeOperationsError(
            'purpose_not_personal_home',
            'Personal Home purpose, canonical layout, or identity changed while waiting for both relocation locks.',
          );
        }
      },
      stopSource: async () => {
        input.progress?.('stopping_source');
        await deps.lifecycle.stop();
        if (await deps.lifecycle.isRunning()) {
          throw new PersonalHomeOperationsError('home_stop_failed', 'Personal Home did not stop; relocation was not attempted.');
        }
      },
      isSourceRunning: () => deps.lifecycle.isRunning(),
      startSource: async () => { input.progress?.('rolling_back_source'); await deps.lifecycle.start(); },
      priorSourceRunning: await deps.lifecycle.isRunning(),
      checkCancelledBeforeCutover: () => checkCancelled(input),
      createFinalBackup: async () => {
        const outputPath = join(layout.backupsDir, `personal-home-relocation-${randomUUID()}.tar`);
        const stagingDir = join(dirname(layout.dataDir), `.personal-home-relocation-backup-${process.pid}-${randomUUID()}`);
        return createPersonalHomeBackupWithLease({
          layout,
          outputPath,
          stagingDir,
          homeServerIdentityId: identity.homeServerIdentityId,
          schemaVersion: identity.schemaVersion,
          happierVersion: await readHappierVersion(),
          configuration: await deps.readConfiguration(layout),
          sqlite: await deps.sqliteMaintenance(layout.databasePath),
          operationLeaseHeld: true,
        });
      },
      prepareDestination: async () => { input.progress?.('staging_destination'); await adapter.prepareDestination({ dataDir: input.destinationDataDir }); },
      transfer: adapter.transfer,
      restoreDestination: async (archivePath) => {
        input.progress?.('restoring_destination');
        await adapter.restoreDestinationWithLease({ dataDir: input.destinationDataDir, archivePath, operationLeaseHeld: true });
      },
      verifyDestination: async () => { input.progress?.('verifying_destination'); return adapter.verifyDestination({ dataDir: input.destinationDataDir }); },
      startDestination: async () => { input.progress?.('starting_destination'); return adapter.startDestination({ dataDir: input.destinationDataDir }); },
      stopDestination: () => adapter.stopDestination({ dataDir: input.destinationDataDir }),
      quarantineDestination: () => adapter.quarantineDestination({ dataDir: input.destinationDataDir }),
      commitSameHomeRelocation: adapter.commitSameHomeRelocation,
      destinationDescriptor: input.destinationDescriptor,
      ...(input.publicIntegrationsNeedAttention
        ? { publicIntegrationsNeedAttention: input.publicIntegrationsNeedAttention }
        : {}),
      ...(input.followerAction ? { followerAction: input.followerAction } : {}),
    });
  };

  return Object.freeze({
    inspect,
    backup,
    verifyBackup,
    restore,
    erase,
    recoverRestore,
    finalizeRestore,
    relocate,
  } satisfies PersonalHomeOperations);
}
