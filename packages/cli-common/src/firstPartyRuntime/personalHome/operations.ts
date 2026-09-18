import { createHash, randomUUID } from 'node:crypto';
import { lstat, opendir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { inspectPersonalHomeArchive } from './archive.js';
import {
  createPersonalHomeBackupWithLease,
  listPersonalHomeBackupArchives,
  type PersonalHomeBackupResult,
  type PersonalHomeSqliteMaintenance,
} from './backup.js';
import { preparePersonalHomeDataErase, PersonalHomeEraseError, resolvePersonalHomeEraseTargets } from './erase.js';
import type { PersonalHomeRuntimeLayout } from './layout.js';
import type { PersonalHomeRestorableConfigurationV1 } from './configuration.js';
import type { PersonalHomeAuthenticatedReadiness } from './readiness.js';
import { withPersonalHomeOperationAdmission } from './operationAdmission.js';
import { fingerprintMasterSecret, type PersonalHomeBackupManifestV1 } from './manifest.js';
import type { ManagedRelayPurpose } from './personalHomeRuntimeSpec.js';
import {
  coordinatePersonalHomeRelocation,
  inspectPersonalHomeRelocationSourceRecovery,
  type PersonalHomeRelocationSourceCoordinatorParams,
  type PersonalHomeRelocationSourceRecoveryFacts,
  type PersonalHomeRelocationSourceResult,
} from './relocationCoordinator.js';
import type { PersonalHomeRelocationDestinationOwner } from './relocationDestination.js';
import {
  inspectPersonalHomeRestoreRecovery,
  finalizePersonalHomeRestoreWithLease,
  hasMeaningfulPersonalHomeData,
  reconcilePersonalHomeRestoreWithLease,
  recoverPersonalHomeRestoreWithLease,
  restorePersonalHomeBackupWithLease,
  type PersonalHomeRestoreRecoveryFacts,
  type PersonalHomeRestoreRecoveryResult,
  type PersonalHomeRestoreFinalizationResult,
  type PersonalHomeRestoreResult,
} from './restore.js';

export type PersonalHomeBackupOperationResult = PersonalHomeBackupResult;
export type PersonalHomeRestoreOperationResult = PersonalHomeRestoreResult;
export type PersonalHomeRelocateOperationResult = PersonalHomeRelocationSourceResult;

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
      | 'home_restart_failed'
      | 'operation_cancelled'
      | 'erase_preview_incomplete'
      | 'restore_unavailable'
      | 'restore_recovery_required'
      | 'operation_recovery_required'
      | 'relocation_unavailable',
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'PersonalHomeOperationsError';
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause, configurable: true });
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
    quarantine?(): Promise<void>;
    activate?(): Promise<void>;
    readServiceStatus?(): Promise<Readonly<{ running: boolean; quarantined: boolean }>>;
    healthCheck?(): Promise<boolean>;
  }>;
  /** SQLite maintenance for one database (offline TRUNCATE checkpoint + quick_check). */
  sqliteMaintenance(databasePath: string): Promise<PersonalHomeSqliteMaintenance>;
  migrateStagedDatabase?(layout: PersonalHomeRuntimeLayout, databasePath: string, manifest: PersonalHomeBackupManifestV1): Promise<void>;
  readIdentityFromDatabase?(layout: PersonalHomeRuntimeLayout, databasePath: string): Promise<PersonalHomeIdentityFacts>;
  readDataCountsFromDatabase?(layout: PersonalHomeRuntimeLayout, databasePath: string): Promise<Readonly<{ accountCount: number; sessionCount: number }>>;
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
  /** Server-light readiness receipt, produced only after AuthModule mints and
   * verifies a present-user token against the activated restored Home. */
  attestActivatedHome?(): Promise<PersonalHomeAuthenticatedReadiness>;
  /** Fresh runtime version recorded in backup manifests. */
  readHappierVersion?(): Promise<string>;
  /** Transitional direct-owner test compatibility; canonical production factory uses reader. */
  happierVersion?: string;
  /** Installed migration metadata owner; callers cannot guess ordering from migration names. */
  isSchemaSupported?(layout: PersonalHomeRuntimeLayout, schemaVersion: string): Promise<boolean>;
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
    /** False when a candidate could not be quick-confirmed within the archive parser's real resource limits; then `backupsCount` is a confirmed lower bound. */
    backupsCountComplete: boolean;
    latestBackup: Readonly<{ path: string; createdAt: string; archiveBytes: number }> | null;
    ownedErasePaths: readonly string[];
    estimatedOwnedBytes: number | null;
    estimatedOwnedBytesComplete: boolean;
    estimatedOwnedBytesReason: string | null;
    destinationEmpty: boolean;
  }>;
  restoreRecovery: PersonalHomeRestoreRecoveryFacts;
  relocationRecovery: PersonalHomeRelocationSourceRecoveryFacts;
}>;

export type PersonalHomeBackupOperationInput = Readonly<{
  outputPath?: string;
} & PersonalHomeOperationContext>;

export type PersonalHomeOperationContext = Readonly<{
  signal?: AbortSignal;
  progress?(stepId: string, message?: string): void;
  /** Task-origin purpose binding; rejects a Home switch between request and execution. */
  expectedCanonicalServerUrl?: string;
}>;

export type PersonalHomeBackupVerification = Readonly<{
  manifest: PersonalHomeBackupManifestV1;
  archiveBytes: number;
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
  previewComplete: boolean;
  previewReason: string | null;
}>;

export type PersonalHomeEraseOperationInput = Readonly<{
  confirm(facts: PersonalHomeEraseConfirmationFacts): Promise<boolean>;
} & PersonalHomeOperationContext>;

export type PersonalHomeEraseOperationResult = Readonly<{
  outcome: 'completed' | 'completed_with_cleanup_attention' | 'partial';
  removedPaths: readonly string[];
  remainingOwnedPaths: readonly string[];
  remainingUnknownPaths: readonly string[];
  stoppedRunningHome: boolean;
  inspectionComplete: boolean;
  inspectionError: string | null;
  error: string | null;
}>;

export type PersonalHomeRelocateInput = Readonly<{
  operationId: string;
  sourceDescriptorRevision: number;
  destinationMachineId: string;
  recoveryAction?: 'finish_move' | 'return_to_source';
  destination: PersonalHomeRelocationDestinationOwner;
  publishDestination: PersonalHomeRelocationSourceCoordinatorParams['publishDestination'];
  readPublishedDescriptor: PersonalHomeRelocationSourceCoordinatorParams['readPublishedDescriptor'];
} & PersonalHomeOperationContext>;

export type PersonalHomeOperations = Readonly<{
  inspect(context?: PersonalHomeOperationContext): Promise<PersonalHomeInspection>;
  backup(input?: PersonalHomeBackupOperationInput): Promise<PersonalHomeBackupResult>;
  verifyBackup(input: Readonly<{ archivePath: string } & PersonalHomeOperationContext>): Promise<PersonalHomeBackupVerification>;
  restore(input: PersonalHomeRestoreOperationInput): Promise<PersonalHomeRestoreResult>;
  erase(input: PersonalHomeEraseOperationInput): Promise<PersonalHomeEraseOperationResult>;
  reconcileRestore(input?: PersonalHomeOperationContext): Promise<PersonalHomeRestoreFinalizationResult>;
  recoverRestore(input?: PersonalHomeOperationContext): Promise<PersonalHomeRestoreRecoveryResult>;
  relocate(input: PersonalHomeRelocateInput): Promise<PersonalHomeRelocateOperationResult>;
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

type PersonalHomeOwnedBytesPreview = Readonly<{ bytes: number; complete: boolean; reason: string | null }>;

async function estimateOwnedBytes(paths: readonly string[], checkCancelled: () => void = () => undefined): Promise<PersonalHomeOwnedBytesPreview> {
  const pending = [...paths];
  const visited = new Set<string>();
  let total = 0;
  try {
    while (pending.length > 0) {
      checkCancelled();
      const path = pending.pop()!;
      if (visited.has(path)) continue;
      visited.add(path);
      const info = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (!info) continue;
      if (info.isSymbolicLink()) throw new Error(`symbolic link encountered at ${path}`);
      if (info.isFile()) {
        total += info.size;
        continue;
      }
      if (!info.isDirectory()) continue;
      for await (const entry of await opendir(path)) pending.push(join(path, entry.name));
    }
    return { bytes: total, complete: true, reason: null };
  } catch (error) {
    if (error instanceof PersonalHomeOperationsError && error.code === 'operation_cancelled') throw error;
    const reason = error instanceof Error && error.message.trim() ? error.message.trim() : 'unknown filesystem inspection error';
    return { bytes: total, complete: false, reason };
  }
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
  const reconcileRestoreWithLease = async (layout: PersonalHomeRuntimeLayout): Promise<PersonalHomeRestoreFinalizationResult> => {
    return await reconcilePersonalHomeRestoreWithLease({
      layout,
      operationLeaseHeld: true,
      isHomeRunning: () => deps.lifecycle.isRunning(),
      stopHome: () => deps.lifecycle.stop(),
      healthCheck: healthCheck ?? (async () => false),
      readIdentity: () => deps.readIdentity(layout),
      readDataCountsFromDatabase: (databasePath) => deps.readDataCountsFromDatabase
        ? deps.readDataCountsFromDatabase(layout, databasePath)
        : Promise.reject(new Error('Canonical Personal Home data-count reader is unavailable.')),
      attestActivatedHome: () => deps.attestActivatedHome
        ? deps.attestActivatedHome()
        : Promise.reject(new Error('Canonical Personal Home authenticated readiness is unavailable.')),
      finalizeConfiguration: (artifact) => deps.finalizeConfiguration
        ? deps.finalizeConfiguration(layout, artifact)
        : Promise.reject(new Error('Canonical Personal Home configuration finalizer is unavailable.')),
    });
  };
  const withStableLayoutLease = async <T>(kind: 'inspect' | 'backup' | 'verify_backup' | 'restore' | 'erase' | 'relocate', context: PersonalHomeOperationContext, fn: (layout: PersonalHomeRuntimeLayout, purpose: PersonalHomePurpose) => Promise<T>, reconcileRestore = true): Promise<T> => {
    return withPersonalHomeOperationAdmission({
      request: kind === 'relocate'
        ? { kind, role: 'source', operationId: 'operationId' in context && typeof context.operationId === 'string' ? context.operationId : '' }
        : { kind },
      readValidatedTarget: async () => {
        checkCancelled(context);
        const purpose = await deps.readPurpose(); assertPersonalHomePurpose(purpose); assertExpectedPurpose(purpose, context);
        const layout = await deps.resolveLayout(); await deps.validateLayout(layout);
        return { layout, canonicalServerUrl: purpose.canonicalServerUrl, homeServerIdentityId: (await readIdentityOrNull(layout))?.homeServerIdentityId ?? null };
      },
      isHomeRunning: deps.lifecycle.isRunning,
    }, async ({ layout, canonicalServerUrl }) => {
      if (reconcileRestore) {
        const reconciliation = await reconcileRestoreWithLease(layout);
        if (reconciliation.outcome === 'recovery_required' && kind !== 'inspect') {
          throw new PersonalHomeOperationsError(
            'restore_recovery_required',
            reconciliation.error ?? 'Personal Home restore requires recovery before another operation can continue.',
          );
        }
      }
      return fn(layout, { kind: 'personal-home', canonicalServerUrl: canonicalServerUrl! });
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

  const restorePreviouslyRunningHome = async (): Promise<void> => {
    if (!await deps.lifecycle.isRunning()) {
      await deps.lifecycle.start();
    }
    if (!await deps.lifecycle.isRunning()) {
      throw new Error('the service did not report running');
    }
    if (healthCheck && !await healthCheck()) {
      throw new Error('the Home health check failed');
    }
  };

  const restorePreviouslyRunningHomeOrRethrow = async (
    operation: 'Backup' | 'Restore' | 'Erase',
    originalError: unknown,
  ): Promise<never> => {
    try {
      await restorePreviouslyRunningHome();
    } catch (restartError) {
      const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
      const restartMessage = restartError instanceof Error ? restartError.message : String(restartError);
      const operationContext = operation === 'Erase'
        ? `Erase was not performed (${originalMessage})`
        : `${operation} did not complete (${originalMessage})`;
      throw new PersonalHomeOperationsError(
        'home_restart_failed',
        `${operationContext}; Personal Home restart could not be verified and needs attention: ${restartMessage}.`,
        originalError,
      );
    }
    throw originalError;
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

  const createBackupWithHeldLease = async (params: Readonly<{
    layout: PersonalHomeRuntimeLayout;
    identity: PersonalHomeIdentityFacts;
    outputPath: string;
    context: PersonalHomeOperationContext;
    keepStoppedAfterSuccess?: boolean;
  }>): Promise<Readonly<{ backup: PersonalHomeBackupResult; wasRunning: boolean }>> => {
    const stagingDir = join(dirname(params.layout.dataDir), `.personal-home-backup-${process.pid}-${randomUUID()}`);
    const wasRunning = await deps.lifecycle.isRunning();
    let homeNeedsAttention = false;
    let result: PersonalHomeBackupResult | undefined;
    let operationError: unknown;
    try {
      if (wasRunning) {
        checkCancelled(params.context);
        params.context.progress?.('stopping_home');
        await deps.lifecycle.stop();
        if (await deps.lifecycle.isRunning()) throw new PersonalHomeOperationsError('home_stop_failed', 'Personal Home did not stop; backup was not attempted.');
      }
      const maintenance = await deps.sqliteMaintenance(params.layout.databasePath);
      result = await createPersonalHomeBackupWithLease({
        layout: params.layout,
        outputPath: params.outputPath,
        stagingDir,
        homeServerIdentityId: params.identity.homeServerIdentityId,
        schemaVersion: params.identity.schemaVersion,
        happierVersion: await readHappierVersion(),
        configuration: await deps.readConfiguration(params.layout),
        sqlite: {
          checkpoint: async () => { params.context.progress?.('checkpointing'); return maintenance.checkpoint(); },
          quickCheck: async () => { params.context.progress?.('validating_database'); return maintenance.quickCheck(); },
          close: () => maintenance.close(),
        },
        operationLeaseHeld: true,
      });
    } catch (error) {
      operationError = error;
    }
    if (wasRunning && (!params.keepStoppedAfterSuccess || !result)) {
      params.context.progress?.('restarting_home');
      if (operationError !== undefined) {
        await restorePreviouslyRunningHomeOrRethrow('Backup', operationError);
      }
      try {
        await restorePreviouslyRunningHome();
      } catch {
        homeNeedsAttention = true;
      }
    }
    if (operationError !== undefined) throw operationError;
    if (!result) throw new Error('Personal Home backup did not produce a result');
    return {
      backup: homeNeedsAttention ? { ...result, homeNeedsAttention: true } : result,
      wasRunning,
    };
  };

  const inspect = async (context: PersonalHomeOperationContext = {}): Promise<PersonalHomeInspection> => {
    context.progress?.('acquiring_lock');
    // Reconcile operation-owned recovery and pin the canonical target while briefly holding the
    // mutation lease. Potentially unbounded passive filesystem/archive enumeration happens only
    // after that lease is released, so Settings inspection cannot starve real Home operations.
    const { layout, purpose } = await withStableLayoutLease('inspect', context, async (stableLayout, stablePurpose) => ({
      layout: stableLayout,
      purpose: stablePurpose,
    }));
    context.progress?.('inspecting');
    const ownedErasePaths = resolvePersonalHomeEraseTargets(layout);
    const [identity, masterSecret, running, databaseBytes, publicFilesPresent, privateFilesPresent, backupInventory, restoreRecovery, relocationRecovery, ownedBytesPreview, destinationHasData] =
    await Promise.all([
      readIdentityOrNull(layout),
      readMasterSecretFacts(layout),
      deps.lifecycle.isRunning(),
      fileSizeOrNull(layout.databasePath),
      isDirectory(layout.publicFilesDir),
      isDirectory(layout.privateFilesDir),
      listPersonalHomeBackupArchives(layout.backupsDir, () => checkCancelled(context)),
      inspectPersonalHomeRestoreRecovery(layout).catch((): PersonalHomeRestoreRecoveryFacts => ({ status: 'ambiguous', affectedTargets: [] })),
      inspectPersonalHomeRelocationSourceRecovery(layout.dataDir),
      estimateOwnedBytes(ownedErasePaths, () => checkCancelled(context)),
      hasMeaningfulPersonalHomeData(layout),
    ]);
    const currentPurpose = await deps.readPurpose();
    assertPersonalHomePurpose(currentPurpose);
    assertExpectedPurpose(currentPurpose, context);
    const currentLayout = await deps.resolveLayout();
    await deps.validateLayout(currentLayout);
    if (currentPurpose.canonicalServerUrl !== purpose.canonicalServerUrl || JSON.stringify(currentLayout) !== JSON.stringify(layout)) {
      throw new PersonalHomeOperationsError('purpose_not_personal_home', 'Personal Home purpose or canonical layout changed during inspection.');
    }
    return {
      purpose: 'personal-home',
      canonicalServerUrl: purpose.canonicalServerUrl,
      layout,
      running,
      identity,
      masterSecret,
      storage: {
        databasePresent: databaseBytes !== null,
        databaseBytes,
        publicFilesPresent,
        privateFilesPresent,
        backupsCount: backupInventory.count,
        backupsCountComplete: backupInventory.complete,
        latestBackup: backupInventory.latest,
        ownedErasePaths,
        estimatedOwnedBytes: ownedBytesPreview.bytes,
        estimatedOwnedBytesComplete: ownedBytesPreview.complete,
        estimatedOwnedBytesReason: ownedBytesPreview.reason,
        destinationEmpty: !destinationHasData,
      },
      restoreRecovery,
      relocationRecovery,
    };
  };

  const backup = async (input: PersonalHomeBackupOperationInput = {}): Promise<PersonalHomeBackupResult> => {
    input.progress?.('inspecting');
    return withStableLayoutLease('backup', input, async (layout) => {
      const identity = await requireIdentity(layout);
      const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
      const outputPath = input.outputPath ?? join(layout.backupsDir, `personal-home-${timestamp}.tar`);
      return (await createBackupWithHeldLease({
        layout,
        identity,
        outputPath,
        context: input,
      })).backup;
    });
  };

  const verifyBackup = async (input: Readonly<{ archivePath: string } & PersonalHomeOperationContext>): Promise<PersonalHomeBackupVerification> => {
    return withStableLayoutLease('verify_backup', input, async (layout) => {
      input.progress?.('verifying_archive');
      const inspection = await inspectPersonalHomeArchive(input.archivePath);
      const manifest = inspection.manifest;
      const identity = await readIdentityOrNull(layout);
      return {
      manifest,
      archiveBytes: inspection.archiveBytes,
      identityMatchesCurrentHome: identity === null
        ? 'unknown'
        : identity.homeServerIdentityId === manifest.homeServerIdentityId ? 'match' : 'mismatch',
      };
    });
  };

  const restore = async (input: PersonalHomeRestoreOperationInput): Promise<PersonalHomeRestoreResult> => {
    input.progress?.('validating_archive');
    return withStableLayoutLease('restore', input, async (layout) => {
      if (!deps.isSchemaSupported || !deps.migrateStagedDatabase || !deps.readIdentityFromDatabase || !deps.readDataCountsFromDatabase || !deps.inspectConfigurationStorage || !deps.attestActivatedHome || !deps.finalizeConfiguration) throw new PersonalHomeOperationsError('restore_unavailable', 'Personal Home restore schema, migration, identity, data-count, authenticated readiness, configuration storage, and finalization owners are unavailable.');
      const destinationHasData = await hasMeaningfulPersonalHomeData(layout);
      const identity = await readIdentityOrNull(layout);
      if (destinationHasData && !identity) {
        throw new PersonalHomeOperationsError('identity_unavailable', 'Existing Personal Home data cannot be restored because its stored identity is unavailable.');
      }
      const expectedHomeServerIdentityId = identity?.homeServerIdentityId
        ?? (destinationHasData ? undefined : input.expectedHomeServerIdentityId);
      const restored = await restorePersonalHomeBackupWithLease({
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
      ...(destinationHasData ? {
        requireRecoveryArchiveBeforeMutation: true,
        createRecoveryArchiveBeforeMutation: async () => {
          input.progress?.('creating_recovery_archive');
          const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
          const prepared = await createBackupWithHeldLease({
            layout,
            identity: identity!,
            outputPath: join(layout.backupsDir, `personal-home-pre-restore-${timestamp}.tar`),
            context: input,
            keepStoppedAfterSuccess: true,
          });
          try {
            checkCancelled(input);
          } catch (error) {
            if (prepared.wasRunning) await restorePreviouslyRunningHomeOrRethrow('Restore', error);
            throw error;
          }
          return { archive: prepared.backup, wasRunning: prepared.wasRunning };
        },
      } : {}),
      requireDataCountVerification: true,
      readDataCountsFromDatabase: (databasePath: string) => deps.readDataCountsFromDatabase!(layout, databasePath),
      verifyIdentity: async (manifest: PersonalHomeBackupManifestV1) =>
        (await deps.readIdentity(layout)).homeServerIdentityId === manifest.homeServerIdentityId,
      requireAuthenticatedAttestation: true,
      attestActivatedHome: () => deps.attestActivatedHome!(),
      });
      if (restored.outcome !== 'restored') return restored;
      input.progress?.('finalizing_restore');
      const finalization = await finalizePersonalHomeRestoreWithLease({
        layout,
        operationLeaseHeld: true,
        finalizeConfiguration: (artifact) => deps.finalizeConfiguration!(layout, artifact),
      });
      if (finalization.outcome !== 'finalized') {
        return {
          ...restored,
          outcome: 'recovery_required',
          error: finalization.error ?? 'Personal Home restore cleanup requires recovery.',
        };
      }
      return { ...restored, rollbackPaths: [] };
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
    }, false);
  };

  const reconcileRestore = async (input: PersonalHomeOperationContext = {}): Promise<PersonalHomeRestoreFinalizationResult> => {
    return await withStableLayoutLease('inspect', input, async (layout) => await reconcileRestoreWithLease(layout), false);
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
          'Personal Home restore state is ambiguous; recover it or complete operation-owned cleanup before erasing data.',
        );
      }
      if (restoreRecovery.status !== 'none') {
        throw new PersonalHomeOperationsError(
          'restore_recovery_required',
          'Personal Home restore recovery or finalization is required before erasing data.',
        );
      }
      const paths = resolvePersonalHomeEraseTargets(layout);
      const preview = await estimateOwnedBytes(paths, () => checkCancelled(input));
      if (!preview.complete) {
        throw new PersonalHomeOperationsError(
          'erase_preview_incomplete',
          `Personal Home erase preview could not be completed; no confirmation or deletion was attempted: ${preview.reason ?? 'unknown filesystem inspection error'}.`,
        );
      }
      const identity = await requireIdentity(layout);
      const previewRunning = await deps.lifecycle.isRunning();
      checkCancelled(input);
      input.progress?.('awaiting_confirmation');
      if (!await input.confirm({
        canonicalServerUrl: purpose.canonicalServerUrl,
        homeServerIdentityId: identity.homeServerIdentityId,
        paths,
        estimatedBytes: preview.bytes,
        previewComplete: true,
        previewReason: null,
      })) {
        throw new PersonalHomeEraseError(
          'confirmation_required',
          'Personal Home data deletion was not explicitly confirmed.',
        );
      }
      checkCancelled(input);

      const currentPurpose = await deps.readPurpose();
      assertPersonalHomePurpose(currentPurpose);
      assertExpectedPurpose(currentPurpose, input);
      const currentLayout = await deps.resolveLayout();
      await deps.validateLayout(currentLayout);
      const currentIdentity = await requireIdentity(currentLayout);
      const currentPaths = resolvePersonalHomeEraseTargets(currentLayout);
      const currentPreview = await estimateOwnedBytes(currentPaths, () => checkCancelled(input));
      const currentRunning = await deps.lifecycle.isRunning();
      if (currentPurpose.canonicalServerUrl !== purpose.canonicalServerUrl
        || JSON.stringify(currentLayout) !== JSON.stringify(layout)
        || currentIdentity.homeServerIdentityId !== identity.homeServerIdentityId
        || JSON.stringify(currentPaths) !== JSON.stringify(paths)
        || !currentPreview.complete
        || currentPreview.bytes !== preview.bytes
        || currentRunning !== previewRunning) {
        throw new PersonalHomeOperationsError(
          'purpose_not_personal_home',
          'Personal Home identity, layout, erase preview, or writer state changed after confirmation; erase was not attempted.',
        );
      }

      const wasRunning = previewRunning;
      let deleteData: Awaited<ReturnType<typeof preparePersonalHomeDataErase>>;
      try {
        if (wasRunning) {
          input.progress?.('stopping_home');
          await deps.lifecycle.stop();
        }
        checkCancelled(input);
        deleteData = await preparePersonalHomeDataErase({ layout, operationLeaseHeld: true });
        if (await deps.lifecycle.isRunning()) {
          throw new PersonalHomeOperationsError('home_stop_failed', 'Personal Home did not remain stopped; erase was not attempted.');
        }
        checkCancelled(input);
        input.progress?.('erasing');
      } catch (error) {
        if (wasRunning) await restorePreviouslyRunningHomeOrRethrow('Erase', error);
        throw error;
      }
      // No recovery restart is safe beyond this point: deletion may have removed only part
      // of a database or file tree even when the filesystem reports an error.
      const result = await deleteData();
      return {
        outcome: result.outcome,
        removedPaths: result.removedPaths,
        remainingOwnedPaths: result.remainingOwnedPaths,
        remainingUnknownPaths: result.remainingUnknownPaths,
        stoppedRunningHome: wasRunning,
        inspectionComplete: result.inspectionComplete,
        inspectionError: result.inspectionError,
        error: result.error,
      };
    });
  };

  const relocate = async (input: PersonalHomeRelocateInput): Promise<PersonalHomeRelocateOperationResult> => {
    checkCancelled(input);
    input.progress?.('preflight');
    const purpose = await deps.readPurpose(); assertPersonalHomePurpose(purpose); assertExpectedPurpose(purpose, input);
    const layout = await deps.resolveLayout();
    await deps.validateLayout(layout);
    const identity = await requireIdentity(layout);
    if (!deps.lifecycle.quarantine || !deps.lifecycle.activate || !deps.lifecycle.readServiceStatus) {
      throw new PersonalHomeOperationsError('relocation_unavailable', 'Personal Home service quarantine is unavailable.');
    }
    const quarantineSource = deps.lifecycle.quarantine;
    const activateSource = deps.lifecycle.activate;
    const readSourceServiceStatus = deps.lifecycle.readServiceStatus;
    return withStableLayoutLease('relocate', input, async (leasedLayout, leasedPurpose) => {
      if (leasedPurpose.canonicalServerUrl !== purpose.canonicalServerUrl
        || JSON.stringify(leasedLayout) !== JSON.stringify(layout)) {
        throw new PersonalHomeOperationsError('purpose_not_personal_home', 'Personal Home purpose or layout changed before relocation acquired its source lock.');
      }
      const currentIdentity = await requireIdentity(leasedLayout);
      if (currentIdentity.homeServerIdentityId !== identity.homeServerIdentityId) {
        throw new PersonalHomeOperationsError('identity_unavailable', 'Personal Home identity changed before relocation cutover.');
      }
      const backupName = createHash('sha256').update(input.operationId).digest('hex').slice(0, 24);
      return await coordinatePersonalHomeRelocation({
        sourceDataDir: leasedLayout.dataDir,
        operationId: input.operationId,
        homeServerIdentityId: identity.homeServerIdentityId,
        sourceCanonicalServerUrl: leasedPurpose.canonicalServerUrl,
        sourceDescriptorRevision: input.sourceDescriptorRevision,
        ...(input.recoveryAction ? { recoveryAction: input.recoveryAction } : {}),
        destinationMachineId: input.destinationMachineId,
        ...(input.signal ? { signal: input.signal } : {}),
        progress: (step) => input.progress?.(step),
        destination: input.destination,
        publishDestination: input.publishDestination,
        readPublishedDescriptor: input.readPublishedDescriptor,
        stopSource: async () => {
          const wasRunning = await deps.lifecycle.isRunning();
          if (wasRunning) {
            try {
              await deps.lifecycle.stop();
            } catch (stopError) {
              let stillRunning: boolean;
              try {
                stillRunning = await deps.lifecycle.isRunning();
              } catch (probeError) {
                throw new PersonalHomeOperationsError(
                  'home_stop_failed',
                  `Personal Home stop failed and its running state could not be verified: ${probeError instanceof Error ? probeError.message : String(probeError)}.`,
                );
              }
              if (stillRunning) throw stopError;
              throw stopError;
            }
          }
          if (await deps.lifecycle.isRunning()) throw new PersonalHomeOperationsError('home_stop_failed', 'Personal Home did not stop; relocation was not attempted.');
          return { wasRunning };
        },
        quarantineSource: async () => {
          await quarantineSource();
        },
        activateSource: async () => {
          await activateSource();
        },
        readSourceServiceStatus,
        createFinalBackup: async () => {
          const outputPath = join(leasedLayout.backupsDir, `personal-home-relocation-${backupName}.tar`);
          const stagingDir = join(dirname(leasedLayout.dataDir), `.personal-home-relocation-backup-${process.pid}-${randomUUID()}`);
          const backup = await createPersonalHomeBackupWithLease({
            layout: leasedLayout,
            outputPath,
            stagingDir,
            homeServerIdentityId: identity.homeServerIdentityId,
            schemaVersion: identity.schemaVersion,
            happierVersion: await readHappierVersion(),
            configuration: await deps.readConfiguration(leasedLayout),
            sqlite: await deps.sqliteMaintenance(leasedLayout.databasePath),
            operationLeaseHeld: true,
          });
          return { archivePath: backup.path, bundleSha256: backup.sha256 };
        },
      });
    });
  };

  return Object.freeze({
    inspect,
    backup,
    verifyBackup,
    restore,
    erase,
    reconcileRestore,
    recoverRestore,
    relocate,
  } satisfies PersonalHomeOperations);
}
