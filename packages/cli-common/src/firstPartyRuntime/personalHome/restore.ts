import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { extractVerifiedPersonalHomeArchiveSnapshot, PersonalHomeArchiveError, verifyPersonalHomeArchive, verifyPersonalHomeArchiveSnapshot, withPrivatePersonalHomeArchiveSnapshot } from './archive.js';
import type { PersonalHomeBackupResult, PersonalHomeSqliteMaintenance } from './backup.js';
import type { PersonalHomeRuntimeLayout } from './layout.js';
import { withPersonalHomeOperationLock } from './lock.js';
import { fingerprintMasterSecret, parsePersonalHomeBackupManifest } from './manifest.js';
import { assertStablePersonalHomeSqliteSnapshot, assertPersonalHomeSqliteSidecarsStable } from './sqliteSnapshot.js';
import {
  parsePersonalHomeRestorableConfigurationJsonV1,
  type PersonalHomeRestorableConfigurationV1,
} from './configuration.js';
import { createPersonalHomePathProtection } from './protection.js';
import { removePathDurably, renamePersonalHomePathDurably, replacePersonalHomeFileDurably, syncPersonalHomeParentDirectory } from './durableFile.js';
import { preparePersonalHomeRestorePromotionSources } from './restorePromotion.js';
import type { PersonalHomeAuthenticatedReadiness } from './readiness.js';

export class PersonalHomeRestoreError extends Error {
  constructor(public readonly code: 'destination_not_empty' | 'identity_mismatch' | 'schema_unsupported' | 'insufficient_space' | 'restore_failed' | 'recovery_required', message: string) { super(message); this.name = 'PersonalHomeRestoreError'; }
}
export class PersonalHomeRestoreActivationBlockedError extends Error {
  readonly code = 'PERSONAL_HOME_RESTORE_ACTIVATION_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'PersonalHomeRestoreActivationBlockedError';
  }
}
export type PersonalHomeRestoreResult = Readonly<{ outcome: 'restored' | 'rolled_back' | 'recovery_required'; manifest: Awaited<ReturnType<typeof verifyPersonalHomeArchive>>; recoveryArchive?: PersonalHomeBackupResult; rollbackPaths?: readonly string[]; error?: string; configurationArtifact: 'applied_by_owner' }>;
export type PersonalHomeRestoreHooks = Readonly<{
  expectedHomeServerIdentityId?: string; isSchemaSupported?: (schemaVersion: string) => Promise<boolean>; confirmOverwrite?: boolean;
  isHomeRunning?: () => Promise<boolean>; stopHome?: () => Promise<void>; startHome?: () => Promise<void>; healthCheck?: () => Promise<boolean>;
  checkCancelledBeforeMutation?: () => void;
  verifyIdentity?: (manifest: PersonalHomeRestoreResult['manifest']) => Promise<boolean>;
  attestActivatedHome?: () => Promise<PersonalHomeAuthenticatedReadiness>;
  requireAuthenticatedAttestation?: boolean;
  verifyStagedIdentity?: (databasePath: string, manifest: PersonalHomeRestoreResult['manifest']) => Promise<boolean>;
  sqliteMaintenance?: (databasePath: string) => Promise<PersonalHomeSqliteMaintenance>;
  runMigrations?: (databasePath: string, manifest: PersonalHomeRestoreResult['manifest']) => Promise<void>;
  prepareConfiguration?: (configuration: PersonalHomeRestorableConfigurationV1) => Promise<Readonly<{ rollbackArtifact: string; apply(): Promise<void>; rollback(): Promise<void> }>>;
  createRecoveryArchiveBeforeMutation?: () => Promise<Readonly<{ archive: PersonalHomeBackupResult; wasRunning: boolean }>>;
  requireRecoveryArchiveBeforeMutation?: boolean;
  readDataCountsFromDatabase?: (databasePath: string) => Promise<Readonly<{ accountCount: number; sessionCount: number }>>;
  requireDataCountVerification?: boolean;
  inspectConfigurationStorage?: (configuration: PersonalHomeRestorableConfigurationV1) => Promise<Readonly<{ targetPath: string; incomingBytes: number; rollbackBytes: number }>>;
  readFilesystemCapacity?: (path: string) => Promise<Readonly<{ deviceId: string; availableBytes: number; availableEntries?: number }>>;
}>;

type RestoreEntryState = 'untouched' | 'preserving' | 'preserved' | 'promoting' | 'promoted' | 'rollback_started' | 'rollback_applied';
type RestoreJournalEntry = { target: string; source: string; rollback: string; hadTarget: boolean; state: RestoreEntryState };
type ConfigurationRollbackState = 'pending' | 'applied';
type RestoreJournal = { version: 2; phase: 'prepared' | 'preserving' | 'promoting' | 'applying_configuration' | 'activating' | 'completed' | 'rolling_back'; stage: string; wasRunning: boolean; configurationRollbackArtifact?: string; configurationRollbackState?: ConfigurationRollbackState; entries: RestoreJournalEntry[] };
export type PersonalHomeRestoreRecoveryFacts = Readonly<{ status: 'none' | 'rollback_available' | 'finalization_available' | 'ambiguous'; phase?: RestoreJournal['phase']; affectedTargets: readonly string[] }>;
export type PersonalHomeRestoreRecoveryResult = Readonly<{ outcome: 'rolled_back' | 'recovery_required'; restartedHome: boolean; error?: string }>;
export type PersonalHomeRestoreFinalizationResult = Readonly<{ outcome: 'none' | 'finalized' | 'recovery_required'; removedPaths: readonly string[]; error?: string }>;

const journalPathFor = (layout: PersonalHomeRuntimeLayout): string => join(layout.dataDir, '.operations', 'restore-journal.json');
const protectPersonalHomeRestorePath = createPersonalHomePathProtection();
const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true).catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
export async function hasMeaningfulPersonalHomeData(layout: PersonalHomeRuntimeLayout): Promise<boolean> { for (const path of [layout.databasePath, layout.publicFilesDir, layout.privateFilesDir, layout.masterSecretPath]) if (await exists(path)) return true; return false; }
function assertPlausiblePersonalHomeDataCounts(counts: Readonly<{ accountCount: number; sessionCount: number }>): void {
  if (!Number.isSafeInteger(counts.accountCount) || counts.accountCount < 1) {
    throw new PersonalHomeRestoreError('restore_failed', 'Restored Personal Home account count is not plausible.');
  }
  if (!Number.isSafeInteger(counts.sessionCount) || counts.sessionCount < 0) {
    throw new PersonalHomeRestoreError('restore_failed', 'Restored Personal Home session count is not plausible.');
  }
}
async function moveIfPresent(from: string, to: string): Promise<void> {
  if (!(await exists(from))) return;
  await mkdir(dirname(to), { recursive: true });
  await renamePersonalHomePathDurably(from, to);
}
async function unlinkDurably(path: string): Promise<void> {
  await unlink(path);
  await syncPersonalHomeParentDirectory(path);
}
function targetEntries(layout: PersonalHomeRuntimeLayout, stage: string, id: string): RestoreJournalEntry[] {
  return [
    [layout.databasePath, join(stage, 'database/home.sqlite')], [layout.publicFilesDir, join(stage, 'files/public')],
    [layout.privateFilesDir, join(stage, 'files/private')], [layout.masterSecretPath, join(stage, 'secrets/handy-master-secret.txt')],
    [layout.derivedDataDir, join(stage, 'derived')],
  ].map(([target, source]) => ({ target: target!, source: source!, rollback: `${target}.restore-rollback-${id}`, hadTarget: false, state: 'untouched' }));
}
async function writeJournal(path: string, journal: RestoreJournal): Promise<void> { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await protectPersonalHomeRestorePath(dirname(path), 'directory'); const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temporary, `${JSON.stringify(journal)}\n`, { mode: 0o600 }); await protectPersonalHomeRestorePath(temporary, 'file'); await replacePersonalHomeFileDurably(temporary, path); } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; } }
const RESTORE_PHASES: readonly RestoreJournal['phase'][] = ['prepared', 'preserving', 'promoting', 'applying_configuration', 'activating', 'completed', 'rolling_back'];
const RESTORE_ENTRY_STATES: readonly RestoreEntryState[] = ['untouched', 'preserving', 'preserved', 'promoting', 'promoted', 'rollback_started', 'rollback_applied'];
const UUID_SUFFIX = /([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
function assertCanonicalConfigurationRollbackArtifact(layout: PersonalHomeRuntimeLayout, artifact: string): void {
  const configDir = resolve(layout.configDir);
  const envPath = join(configDir, 'server.env');
  const prefix = `${envPath}.`;
  const suffix = '.restore-rollback';
  const id = artifact.startsWith(prefix) && artifact.endsWith(suffix) ? artifact.slice(prefix.length, -suffix.length) : '';
  if (configDir !== layout.configDir || resolve(artifact) !== artifact || dirname(artifact) !== configDir || UUID_SUFFIX.exec(id)?.[1] !== id) {
    throw new PersonalHomeRestoreError('recovery_required', 'Personal Home configuration rollback artifact is outside the canonical layout.');
  }
}
function parseJournal(layout: PersonalHomeRuntimeLayout, value: string): RestoreJournal {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal is invalid.');
  const record = parsed as Record<string, unknown>;
  const allowedTopLevelFields = record.configurationRollbackArtifact === undefined
    ? ['entries', 'phase', 'stage', 'version', 'wasRunning']
    : record.configurationRollbackState === undefined
      ? ['configurationRollbackArtifact', 'entries', 'phase', 'stage', 'version', 'wasRunning']
      : ['configurationRollbackArtifact', 'configurationRollbackState', 'entries', 'phase', 'stage', 'version', 'wasRunning'];
  if (Object.keys(record).sort().join(',') !== allowedTopLevelFields.sort().join(',')
    || record.version !== 2
    || typeof record.phase !== 'string' || !RESTORE_PHASES.includes(record.phase as RestoreJournal['phase'])
    || typeof record.stage !== 'string'
    || typeof record.wasRunning !== 'boolean'
    || !Array.isArray(record.entries)
    || (record.configurationRollbackArtifact !== undefined && (typeof record.configurationRollbackArtifact !== 'string' || record.configurationRollbackArtifact.length === 0))
    || (record.configurationRollbackState !== undefined && record.configurationRollbackState !== 'pending' && record.configurationRollbackState !== 'applied')
    || (record.configurationRollbackState !== undefined && record.configurationRollbackArtifact === undefined)) {
    throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal is invalid.');
  }
  const stage = resolve(record.stage);
  const dataDir = resolve(layout.dataDir);
  const stageName = basename(stage);
  const stagePrefix = `${basename(dataDir)}.restore-stage-`;
  const stageSuffix = stageName.startsWith(stagePrefix) ? stageName.slice(stagePrefix.length) : '';
  const stageId = stageSuffix.match(UUID_SUFFIX)?.[1];
  const stagePid = stageId ? stageSuffix.slice(0, -(stageId.length + 1)) : '';
  if (stage !== record.stage || dirname(stage) !== dirname(dataDir) || !stageId || stageSuffix !== `${stagePid}-${stageId}` || !/^\d+$/u.test(stagePid)) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal stage is outside the canonical layout.');
  const expectedEntries = targetEntries(layout, stage, stageId);
  if (record.entries.length !== expectedEntries.length) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal is incomplete.');
  const entries: RestoreJournalEntry[] = [];
  const uniquePaths = new Set<string>();
  for (let index = 0; index < record.entries.length; index += 1) {
    const candidate = record.entries[index];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal entry is invalid.');
    const entry = candidate as Record<string, unknown>;
    const expected = expectedEntries[index]!;
    const candidateSource = `${expected.target}.restore-candidate-${stageId}`;
    if (Object.keys(entry).sort().join(',') !== 'hadTarget,rollback,source,state,target'
      || entry.target !== expected.target || (entry.source !== expected.source && entry.source !== candidateSource) || entry.rollback !== expected.rollback
      || typeof entry.hadTarget !== 'boolean' || typeof entry.state !== 'string' || !RESTORE_ENTRY_STATES.includes(entry.state as RestoreEntryState)) {
      throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal entry does not match the canonical layout.');
    }
    for (const path of [entry.target, entry.source, entry.rollback] as string[]) {
      const normalized = resolve(path);
      if (normalized !== path || uniquePaths.has(normalized)) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal paths are duplicated or non-canonical.');
      uniquePaths.add(normalized);
    }
    if (entry.hadTarget === false && (entry.state === 'preserving' || entry.state === 'preserved')) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal state is inconsistent.');
    entries.push({ target: entry.target as string, source: entry.source as string, rollback: entry.rollback as string, hadTarget: entry.hadTarget, state: entry.state as RestoreEntryState });
  }
  const phase = record.phase as RestoreJournal['phase'];
  if (phase === 'prepared' && entries.some((entry) => entry.state !== 'untouched')) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal prepared state is inconsistent.');
  if (phase === 'preserving' && (entries.some((entry) => entry.state === 'promoting' || entry.state === 'promoted') || entries.filter((entry) => entry.state === 'preserving').length > 1)) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal preserving state is inconsistent.');
  if (phase === 'promoting' && (entries.some((entry) => entry.state === 'preserving') || entries.filter((entry) => entry.state === 'promoting').length > 1)) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal promoting state is inconsistent.');
  if (phase !== 'rolling_back' && entries.some((entry) => entry.state === 'rollback_started' || entry.state === 'rollback_applied')) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal rollback state is inconsistent.');
  if ((phase === 'applying_configuration' || phase === 'activating' || phase === 'completed') && (typeof record.configurationRollbackArtifact !== 'string' || entries.slice(0, 4).some((entry) => entry.state !== 'promoted'))) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal activation state is inconsistent.');
  if (typeof record.configurationRollbackArtifact === 'string') assertCanonicalConfigurationRollbackArtifact(layout, record.configurationRollbackArtifact);
  return {
    version: 2,
    phase,
    stage,
    wasRunning: record.wasRunning,
    ...(typeof record.configurationRollbackArtifact === 'string' ? { configurationRollbackArtifact: record.configurationRollbackArtifact } : {}),
    ...(record.configurationRollbackState === 'pending' || record.configurationRollbackState === 'applied' ? { configurationRollbackState: record.configurationRollbackState } : {}),
    entries,
  };
}
async function readJournal(layout: PersonalHomeRuntimeLayout): Promise<RestoreJournal | null> { try { return parseJournal(layout, await readFile(journalPathFor(layout), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
async function journalExists(layout: PersonalHomeRuntimeLayout): Promise<boolean> {
  try {
    await lstat(journalPathFor(layout));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function assertJournalMutationPathsSafe(layout: PersonalHomeRuntimeLayout, journal: RestoreJournal): Promise<void> {
  const configurationPaths = journal.configurationRollbackArtifact
    ? [resolve(layout.configDir), journal.configurationRollbackArtifact]
    : [];
  for (const path of [journal.stage, ...journal.entries.flatMap((entry) => [entry.target, entry.source, entry.rollback]), ...configurationPaths]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore recovery path is a symbolic link.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
async function cleanupJournalPromotionSources(journal: RestoreJournal): Promise<void> {
  for (const entry of journal.entries) {
    if (entry.source.startsWith(`${entry.target}.restore-candidate-`)) await removePathDurably(entry.source);
  }
}
const rollbackable = (journal: RestoreJournal): boolean => (journal.phase !== 'applying_configuration' && journal.phase !== 'activating') || typeof journal.configurationRollbackArtifact === 'string';
export async function inspectPersonalHomeRestoreRecovery(layout: PersonalHomeRuntimeLayout): Promise<PersonalHomeRestoreRecoveryFacts> { const journal = await readJournal(layout); return journal ? { status: journal.phase === 'completed' ? 'finalization_available' : rollbackable(journal) ? 'rollback_available' : 'ambiguous', phase: journal.phase, affectedTargets: journal.entries.filter((entry) => entry.state !== 'untouched').map((entry) => entry.target) } : { status: 'none', affectedTargets: [] }; }
/**
 * Direct process-start admission for the canonical restore journal.
 *
 * Restore activation and a fully-applied rollback both intentionally restart
 * the Home before removing the journal. Every other retained phase represents
 * mixed, staged, or unproven writable state and must stay stopped until the
 * restore owner resumes or recovers it.
 */
export async function assertPersonalHomeRestoreAllowsActivation(layout: PersonalHomeRuntimeLayout): Promise<void> {
  let journal: RestoreJournal | null;
  try {
    journal = await readJournal(layout);
  } catch (error) {
    throw new PersonalHomeRestoreActivationBlockedError(
      error instanceof Error
        ? error.message
        : 'Personal Home restore state is unreadable; recover the restore before starting it.',
    );
  }
  if (!journal || journal.phase === 'activating' || journal.phase === 'completed') return;
  if (journal.phase === 'rolling_back'
    && journal.configurationRollbackArtifact === undefined
    && journal.configurationRollbackState === undefined
    && journal.entries.every((entry) => entry.state === 'untouched' || entry.state === 'rollback_applied')) {
    return;
  }
  throw new PersonalHomeRestoreActivationBlockedError(
    'This Personal Home has an interrupted restore. Recover the restore before starting it.',
  );
}
async function rollbackFromJournal(layout: PersonalHomeRuntimeLayout, journal: RestoreJournal): Promise<void> {
  if (!rollbackable(journal)) throw new PersonalHomeRestoreError('recovery_required', 'Restore configuration or activation state is ambiguous.');
  journal.phase = 'rolling_back'; await writeJournal(journalPathFor(layout), journal);
  for (const entry of [...journal.entries].reverse()) {
    let rollbackExists = await exists(entry.rollback); let targetExists = await exists(entry.target);
    if (entry.state === 'rollback_applied') {
      if ((entry.hadTarget && !targetExists) || (!entry.hadTarget && targetExists)) throw new PersonalHomeRestoreError('recovery_required', `Previous Home target rollback cannot be proven complete: ${entry.target}`);
      continue;
    }
    if (entry.state === 'untouched') continue;
    if ((entry.state === 'rollback_started' || entry.state === 'preserving') && entry.hadTarget && !rollbackExists && targetExists) {
      entry.state = 'rollback_applied';
      await writeJournal(journalPathFor(layout), journal);
      continue;
    }
    entry.state = 'rollback_started';
    await writeJournal(journalPathFor(layout), journal);
    rollbackExists = await exists(entry.rollback); targetExists = await exists(entry.target);
    if (entry.hadTarget) {
      if (rollbackExists) { if (targetExists) await removePathDurably(entry.target); await moveIfPresent(entry.rollback, entry.target); }
      else throw new PersonalHomeRestoreError('recovery_required', `Previous Home target cannot be proven recoverable: ${entry.target}`);
    } else if (targetExists) await removePathDurably(entry.target);
    entry.state = 'rollback_applied';
    await writeJournal(journalPathFor(layout), journal);
  }
}

async function stopHomeBeforeRollback(params: Pick<PersonalHomeRestoreHooks, 'isHomeRunning' | 'stopHome'>): Promise<void> {
  if (params.isHomeRunning && !(await params.isHomeRunning())) return;
  let stopError: unknown;
  try {
    await params.stopHome?.();
  } catch (error) {
    stopError = error;
  }
  if (params.isHomeRunning) {
    if (await params.isHomeRunning()) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home could not be proven stopped before restore rollback.');
    return;
  }
  if (stopError) throw stopError;
}

async function rollbackConfigurationFromJournal(
  layout: PersonalHomeRuntimeLayout,
  journal: RestoreJournal,
  recoverConfiguration: (rollbackArtifact: string) => Promise<void>,
): Promise<void> {
  const artifact = journal.configurationRollbackArtifact;
  if (!artifact) return;
  if (journal.configurationRollbackState !== 'applied') {
    await recoverConfiguration(artifact);
    journal.configurationRollbackState = 'applied';
    journal.phase = 'rolling_back';
    await writeJournal(journalPathFor(layout), journal);
  }
  await removePathDurably(artifact);
  delete journal.configurationRollbackArtifact;
  delete journal.configurationRollbackState;
  journal.phase = 'rolling_back';
  await writeJournal(journalPathFor(layout), journal);
}
export async function recoverPersonalHomeRestoreWithLease(params: Readonly<{ layout: PersonalHomeRuntimeLayout; operationLeaseHeld: true; isHomeRunning(): Promise<boolean>; stopHome(): Promise<void>; startHome(): Promise<void>; healthCheck(): Promise<boolean>; recoverConfiguration(rollbackArtifact: string): Promise<void> }>): Promise<PersonalHomeRestoreRecoveryResult> {
  const path = journalPathFor(params.layout);
  if (!(await journalExists(params.layout))) return { outcome: 'rolled_back', restartedHome: false };
  let journal: RestoreJournal | null;
  try {
    // Journal bytes are intentionally not trusted until the canonical lifecycle owner proves the
    // Home is stopped. A corrupt journal must never leave a possibly active Home serving mixed
    // restore state, even though its serialized paths are rejected before filesystem mutation.
    await stopHomeBeforeRollback(params);
    journal = await readJournal(params.layout);
    if (!journal) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal disappeared during recovery.');
    await assertJournalMutationPathsSafe(params.layout, journal);
  } catch (error) {
    return { outcome: 'recovery_required', restartedHome: false, error: error instanceof Error ? error.message : String(error) };
  }
  let restartedHome = false;
  try {
    await rollbackConfigurationFromJournal(params.layout, journal, params.recoverConfiguration);
    await rollbackFromJournal(params.layout, journal);
    if (journal.wasRunning) { await params.startHome(); restartedHome = true; if (!(await params.healthCheck())) throw new Error('Recovered Personal Home failed health verification'); }
    await cleanupJournalPromotionSources(journal);
    await removePathDurably(journal.stage);
    await unlinkDurably(path);
    return { outcome: 'rolled_back', restartedHome };
  } catch (error) { return { outcome: 'recovery_required', restartedHome, error: error instanceof Error ? error.message : String(error) }; }
}

export async function finalizePersonalHomeRestoreWithLease(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  operationLeaseHeld: true;
  finalizeConfiguration(rollbackArtifact: string): Promise<void>;
}>): Promise<PersonalHomeRestoreFinalizationResult> {
  const path = journalPathFor(params.layout);
  try {
    const journal = await readJournal(params.layout);
    if (!journal) return { outcome: 'none', removedPaths: [] };
    if (journal.phase !== 'completed' || !journal.configurationRollbackArtifact) {
      return { outcome: 'recovery_required', removedPaths: [], error: 'Personal Home restore is not ready for finalization.' };
    }
    await assertJournalMutationPathsSafe(params.layout, journal);
    const removedPaths: string[] = [];
    await params.finalizeConfiguration(journal.configurationRollbackArtifact);
    removedPaths.push(journal.configurationRollbackArtifact);
    for (const entry of journal.entries) {
      if (await exists(entry.rollback)) {
        await removePathDurably(entry.rollback);
        removedPaths.push(entry.rollback);
      }
    }
    await cleanupJournalPromotionSources(journal);
    await removePathDurably(journal.stage);
    await unlinkDurably(path);
    return { outcome: 'finalized', removedPaths };
  } catch (error) {
    return { outcome: 'recovery_required', removedPaths: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reconciles restore state at the existing operations lease boundary. `activating` is durable only
 * after the staged/promoted database-count comparison, so a restarted owner can re-derive every
 * remaining commit fact from the canonical promoted layout plus the server-owned live readiness
 * receipt. No second crash-state store or caller-provided path is needed.
 */
export async function reconcilePersonalHomeRestoreWithLease(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  operationLeaseHeld: true;
  isHomeRunning(): Promise<boolean>;
  stopHome(): Promise<void>;
  healthCheck(): Promise<boolean>;
  readIdentity(): Promise<Readonly<{ homeServerIdentityId: string }>>;
  readDataCountsFromDatabase(databasePath: string): Promise<Readonly<{ accountCount: number; sessionCount: number }>>;
  attestActivatedHome(): Promise<PersonalHomeAuthenticatedReadiness>;
  finalizeConfiguration(rollbackArtifact: string): Promise<void>;
}>): Promise<PersonalHomeRestoreFinalizationResult> {
  if (!(await journalExists(params.layout))) return { outcome: 'none', removedPaths: [] };

  let journal: RestoreJournal;
  try {
    const parsed = await readJournal(params.layout);
    if (!parsed) throw new PersonalHomeRestoreError('recovery_required', 'Personal Home restore journal disappeared during reconciliation.');
    journal = parsed;
  } catch (error) {
    let stopError: unknown;
    await stopHomeBeforeRollback(params).catch((failure) => { stopError = failure; });
    const message = error instanceof Error ? error.message : String(error);
    return {
      outcome: 'recovery_required',
      removedPaths: [],
      error: stopError
        ? `${message} Personal Home could not be proven stopped: ${stopError instanceof Error ? stopError.message : String(stopError)}`
        : message,
    };
  }

  if (journal.phase === 'completed') {
    return finalizePersonalHomeRestoreWithLease(params);
  }

  if (journal.phase !== 'activating') {
    try {
      await stopHomeBeforeRollback(params);
    } catch (error) {
      return { outcome: 'recovery_required', removedPaths: [], error: error instanceof Error ? error.message : String(error) };
    }
    return {
      outcome: 'recovery_required',
      removedPaths: [],
      error: 'Interrupted Personal Home restore requires explicit recovery before another operation can continue.',
    };
  }

  try {
    await assertJournalMutationPathsSafe(params.layout, journal);
    if (!(await params.isHomeRunning())) throw new Error('Interrupted restored Personal Home is not running.');
    if (!(await params.healthCheck())) throw new Error('Interrupted restored Personal Home failed health verification.');
    const manifest = parsePersonalHomeBackupManifest(JSON.parse(await readFile(join(journal.stage, 'manifest.json'), 'utf8')) as unknown);
    const [identity, counts, readiness] = await Promise.all([
      params.readIdentity(),
      params.readDataCountsFromDatabase(params.layout.databasePath),
      params.attestActivatedHome(),
    ]);
    assertPlausiblePersonalHomeDataCounts(counts);
    if (identity.homeServerIdentityId !== manifest.homeServerIdentityId
      || readiness.authenticated !== true
      || readiness.homeServerIdentityId !== manifest.homeServerIdentityId
      || readiness.accountCount !== counts.accountCount
      || readiness.sessionCount !== counts.sessionCount) {
      throw new Error('Interrupted restored Personal Home identity, authentication, or promoted data counts do not match.');
    }
    await assertRestoredPersonalHomeAllowlistedFilesReadable(params.layout, manifest);
    journal.phase = 'completed';
    await writeJournal(journalPathFor(params.layout), journal);
    return finalizePersonalHomeRestoreWithLease(params);
  } catch (error) {
    let stopError: unknown;
    await stopHomeBeforeRollback(params).catch((failure) => { stopError = failure; });
    const message = error instanceof Error ? error.message : String(error);
    return {
      outcome: 'recovery_required',
      removedPaths: [],
      error: stopError
        ? `${message} Personal Home could not be proven stopped: ${stopError instanceof Error ? stopError.message : String(stopError)}`
        : message,
    };
  }
}

export async function restorePersonalHomeBackup(params: Readonly<{ layout: PersonalHomeRuntimeLayout; archivePath: string } & PersonalHomeRestoreHooks>): Promise<PersonalHomeRestoreResult> { return withPersonalHomeOperationLock(params.layout.dataDir, 'restore', () => restorePersonalHomeBackupWithLease({ ...params, operationLeaseHeld: true })); }
export async function restorePersonalHomeBackupWithLease(params: Readonly<{ layout: PersonalHomeRuntimeLayout; archivePath: string; operationLeaseHeld: true } & PersonalHomeRestoreHooks>): Promise<PersonalHomeRestoreResult> {
  return withPrivatePersonalHomeArchiveSnapshot(params.archivePath, (snapshotPath) => restorePersonalHomeBackupFromSnapshot({ ...params, archivePath: snapshotPath }));
}
async function restorePersonalHomeBackupFromSnapshot(params: Readonly<{ layout: PersonalHomeRuntimeLayout; archivePath: string; operationLeaseHeld: true } & PersonalHomeRestoreHooks>): Promise<PersonalHomeRestoreResult> {
  const journalPath = journalPathFor(params.layout); if (await exists(journalPath)) throw new PersonalHomeRestoreError('recovery_required', 'A previous Personal Home restore requires explicit recovery.');
  const manifest = await verifyPersonalHomeArchiveSnapshot(params.archivePath);
  if (params.expectedHomeServerIdentityId && params.expectedHomeServerIdentityId !== manifest.homeServerIdentityId) throw new PersonalHomeRestoreError('identity_mismatch', 'Personal Home identity does not match restore target');
  if (!params.isSchemaSupported || !(await params.isSchemaSupported(manifest.schemaVersion))) throw new PersonalHomeRestoreError('schema_unsupported', 'Personal Home backup schema is not supported by this runtime');
  const destinationHasData = await hasMeaningfulPersonalHomeData(params.layout);
  if (destinationHasData && params.confirmOverwrite !== true) throw new PersonalHomeRestoreError('destination_not_empty', 'Destination Personal Home contains data; explicit overwrite confirmation is required');
  const readCapacity = params.readFilesystemCapacity ?? defaultReadFilesystemCapacity;
  const stageCapacity = await readCapacity(dirname(params.layout.dataDir));
  const stagedBytes = manifest.entries.reduce((total, entry) => total + entry.size, 0);
  if (stageCapacity.availableBytes < stagedBytes) throw new PersonalHomeRestoreError('insufficient_space', 'Insufficient free space for Personal Home restore staging');
  const id = randomUUID(); const stage = `${params.layout.dataDir}.restore-stage-${process.pid}-${id}`; let retainStage = false; let promotionCandidatePaths: readonly string[] = []; await mkdir(stage, { recursive: true });
  try {
    await protectPersonalHomeRestorePath(stage, 'directory');
    try {
      await extractVerifiedPersonalHomeArchiveSnapshot(params.archivePath, stage, { availableBytes: stageCapacity.availableBytes, ...(stageCapacity.availableEntries === undefined ? {} : { availableEntries: stageCapacity.availableEntries }) });
    } catch (error) {
      if (error instanceof PersonalHomeArchiveError && error.code === 'resource_limit') throw new PersonalHomeRestoreError('insufficient_space', 'Insufficient filesystem capacity for Personal Home archive extraction');
      throw error;
    }
    const secret = await readFile(join(stage, 'secrets/handy-master-secret.txt')); if (fingerprintMasterSecret(secret) !== manifest.masterSecretFingerprint) throw new PersonalHomeRestoreError('restore_failed', 'Restored Home master secret fingerprint does not match manifest');
    if (!params.sqliteMaintenance) throw new PersonalHomeRestoreError('restore_failed', 'Canonical SQLite maintenance is required for restore');
    const stagedDatabasePath = join(stage, 'database/home.sqlite');
    if (!params.runMigrations) throw new PersonalHomeRestoreError('restore_failed', 'Canonical staged migration owner is required for restore');
    await params.runMigrations(stagedDatabasePath, manifest);
    const staged = await params.sqliteMaintenance(stagedDatabasePath);
    try {
      await assertStablePersonalHomeSqliteSnapshot({
        databasePath: stagedDatabasePath,
        ...staged,
        checkSidecars: false,
      });
    } finally {
      await staged.close();
    }
    await assertPersonalHomeSqliteSidecarsStable(stagedDatabasePath);
    if (!params.verifyStagedIdentity || !(await params.verifyStagedIdentity(stagedDatabasePath, manifest))) throw new PersonalHomeRestoreError('identity_mismatch', 'Staged Personal Home identity does not match the backup manifest');
    if (params.requireDataCountVerification === true && !params.readDataCountsFromDatabase) {
      throw new PersonalHomeRestoreError('restore_failed', 'Canonical Personal Home data-count verification is required for restore.');
    }
    const stagedDataCounts = params.readDataCountsFromDatabase
      ? await params.readDataCountsFromDatabase(stagedDatabasePath)
      : undefined;
    if (stagedDataCounts) assertPlausiblePersonalHomeDataCounts(stagedDataCounts);
    const configuration = parsePersonalHomeRestorableConfigurationJsonV1(
      await readFile(join(stage, 'configuration/home.env.json'), 'utf8'),
      manifest.homeServerIdentityId,
    );
    if (!params.inspectConfigurationStorage) throw new PersonalHomeRestoreError('restore_failed', 'Canonical Personal Home configuration storage preflight is required');
    const configurationStorage = await params.inspectConfigurationStorage(configuration);
    await assertRestoreTargetFilesystemCapacity(params.layout, manifest, stageCapacity.deviceId, configurationStorage, readCapacity);
    params.checkCancelledBeforeMutation?.();
    const recoveryPreparation = destinationHasData && params.requireRecoveryArchiveBeforeMutation === true
      ? await params.createRecoveryArchiveBeforeMutation?.()
      : undefined;
    if (destinationHasData && params.requireRecoveryArchiveBeforeMutation === true && !recoveryPreparation) {
      throw new PersonalHomeRestoreError('restore_failed', 'A verified pre-restore recovery archive is required before replacing Personal Home data.');
    }
    const recoveryArchive = recoveryPreparation?.archive;
    const wasRunning = recoveryPreparation?.wasRunning ?? await params.isHomeRunning?.() ?? false;
    let journal: RestoreJournal | undefined;
    let journalPersisted = false;
    let configurationRollback: (() => Promise<void>) | undefined;
    try {
      if ((!params.isHomeRunning || await params.isHomeRunning()) && params.stopHome) await params.stopHome();
      if (params.isHomeRunning && await params.isHomeRunning()) throw new PersonalHomeRestoreError('restore_failed', 'Personal Home did not stop; restore was not promoted.');
      if (destinationHasData && await exists(params.layout.databasePath)) { const active = await params.sqliteMaintenance(params.layout.databasePath); try { await assertStablePersonalHomeSqliteSnapshot({ databasePath: params.layout.databasePath, ...active, checkSidecars: false }); } finally { await active.close(); } await assertPersonalHomeSqliteSidecarsStable(params.layout.databasePath); }
      const promotionPreparation = await preparePersonalHomeRestorePromotionSources({
        entries: targetEntries(params.layout, stage, id),
        operationId: id,
        stageDeviceId: stageCapacity.deviceId,
        readFilesystemCapacity: readCapacity,
        beforeMaterialize: async (entries) => {
          journal = { version: 2, phase: 'prepared', stage, wasRunning, entries: entries.map((entry) => ({ ...entry, rollback: `${entry.target}.restore-rollback-${id}`, hadTarget: false, state: 'untouched' })) };
          for (const entry of journal.entries) entry.hadTarget = await exists(entry.target);
          await writeJournal(journalPath, journal);
          journalPersisted = true;
        },
      });
      promotionCandidatePaths = promotionPreparation.candidatePaths;
      if (!journal) throw new PersonalHomeRestoreError('restore_failed', 'Personal Home restore promotion journal was not prepared.');
      for (const entry of journal.entries) if (entry.hadTarget) { journal.phase = 'preserving'; entry.state = 'preserving'; await writeJournal(journalPath, journal); await moveIfPresent(entry.target, entry.rollback); entry.state = 'preserved'; await writeJournal(journalPath, journal); }
      journal.phase = 'promoting'; await writeJournal(journalPath, journal);
      for (const entry of journal.entries) if (await exists(entry.source)) { entry.state = 'promoting'; await writeJournal(journalPath, journal); await moveIfPresent(entry.source, entry.target); entry.state = 'promoted'; await writeJournal(journalPath, journal); }
      if (!params.prepareConfiguration) throw new Error('Canonical Personal Home configuration owner is required');
      const preparedConfiguration = await params.prepareConfiguration(configuration); configurationRollback = preparedConfiguration.rollback; journal.configurationRollbackArtifact = preparedConfiguration.rollbackArtifact; journal.configurationRollbackState = 'pending'; await writeJournal(journalPath, journal);
      journal.phase = 'applying_configuration'; await writeJournal(journalPath, journal); await preparedConfiguration.apply();
      if (stagedDataCounts && params.readDataCountsFromDatabase) {
        const promotedDataCounts = await params.readDataCountsFromDatabase(params.layout.databasePath);
        assertPlausiblePersonalHomeDataCounts(promotedDataCounts);
        if (promotedDataCounts.accountCount !== stagedDataCounts.accountCount || promotedDataCounts.sessionCount !== stagedDataCounts.sessionCount) {
          throw new PersonalHomeRestoreError('restore_failed', 'Restored Personal Home account/session counts differ from the verified post-migration stage.');
        }
      }
      journal.phase = 'activating'; await writeJournal(journalPath, journal); if (params.startHome) await params.startHome(); if (params.healthCheck && !(await params.healthCheck())) throw new Error('Personal Home health check failed'); if (params.verifyIdentity && !(await params.verifyIdentity(manifest))) throw new Error('Personal Home identity verification failed');
      if (params.requireAuthenticatedAttestation === true && !params.attestActivatedHome) throw new Error('Canonical Personal Home authenticated readiness is required');
      if (params.attestActivatedHome) {
        const readiness = await params.attestActivatedHome();
        if (
          readiness.authenticated !== true
          || readiness.homeServerIdentityId !== manifest.homeServerIdentityId
          || !Number.isSafeInteger(readiness.accountCount)
          || readiness.accountCount < 1
          || !Number.isSafeInteger(readiness.sessionCount)
          || readiness.sessionCount < 0
        ) throw new Error('Personal Home authenticated readiness attestation failed');
      }
      await assertRestoredPersonalHomeAllowlistedFilesReadable(params.layout, manifest);
      journal.phase = 'completed'; await writeJournal(journalPath, journal);
      return { outcome: 'restored', manifest, ...(recoveryArchive ? { recoveryArchive } : {}), rollbackPaths: journal.entries.filter((entry) => entry.hadTarget).map((entry) => entry.rollback), configurationArtifact: 'applied_by_owner' };
    } catch (error) {
      if (!journalPersisted || !journal) {
        let failed = false;
        if (wasRunning && params.startHome) {
          await params.startHome().catch(() => { failed = true; });
          if (!failed && params.healthCheck && !(await params.healthCheck())) failed = true;
        }
        return { outcome: failed ? 'recovery_required' : 'rolled_back', manifest, ...(recoveryArchive ? { recoveryArchive } : {}), error: error instanceof Error ? error.message : String(error), configurationArtifact: 'applied_by_owner' };
      }
      const persistedJournal = journal;
      let failed = false;
      await stopHomeBeforeRollback(params).catch(() => { failed = true; });
      if (!failed && configurationRollback) await rollbackConfigurationFromJournal(params.layout, persistedJournal, async () => configurationRollback!()).catch(() => { failed = true; });
      if (!failed) { persistedJournal.phase = 'rolling_back'; await writeJournal(journalPath, persistedJournal).catch(() => { failed = true; }); }
      if (!failed) await rollbackFromJournal(params.layout, persistedJournal).catch(() => { failed = true; });
      if (!failed && wasRunning && params.startHome) { await params.startHome().catch(() => { failed = true; }); if (!failed && params.healthCheck && !(await params.healthCheck())) failed = true; }
      if (!failed) await unlinkDurably(journalPath).catch(() => { failed = true; });
      retainStage = failed;
      return { outcome: failed ? 'recovery_required' : 'rolled_back', manifest, ...(recoveryArchive ? { recoveryArchive } : {}), rollbackPaths: persistedJournal.entries.filter((entry) => entry.hadTarget).map((entry) => entry.rollback), error: error instanceof Error ? error.message : String(error), configurationArtifact: 'applied_by_owner' };
    }
  } finally {
    if (!retainStage) {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      await Promise.all(promotionCandidatePaths.map(async (path) => rm(path, { recursive: true, force: true }).catch(() => undefined)));
    }
  }
}

type FilesystemCapacity = Readonly<{ deviceId: string; availableBytes: number; availableEntries?: number }>;
async function defaultReadFilesystemCapacity(path: string): Promise<FilesystemCapacity> {
  let probe = path;
  while (!(await exists(probe))) { const parent = dirname(probe); if (parent === probe) break; probe = parent; }
  const [info, usage] = await Promise.all([stat(probe), statfs(probe)]);
  return { deviceId: String(info.dev), availableBytes: usage.bavail * usage.bsize, availableEntries: usage.ffree };
}
function bytesForTarget(manifest: PersonalHomeRestoreResult['manifest'], target: 'database' | 'public' | 'private' | 'secret'): number {
  const matches = target === 'database' ? (path: string) => path === 'database/home.sqlite'
    : target === 'public' ? (path: string) => path.startsWith('files/public/')
      : target === 'private' ? (path: string) => path.startsWith('files/private/')
        : (path: string) => path === 'secrets/handy-master-secret.txt';
  return manifest.entries.filter((entry) => matches(entry.path)).reduce((total, entry) => total + entry.size, 0);
}
async function ownedBytes(path: string): Promise<number> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new PersonalHomeRestoreError('restore_failed', `Restore target is a symbolic link: ${path}`);
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    let total = 0;
    for (const name of await readdir(path)) total += await ownedBytes(join(path, name));
    return total;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
}
async function assertRestoreTargetFilesystemCapacity(
  layout: PersonalHomeRuntimeLayout,
  manifest: PersonalHomeRestoreResult['manifest'],
  stageDeviceId: string,
  configuration: Readonly<{ targetPath: string; incomingBytes: number; rollbackBytes: number }>,
  readCapacity: (path: string) => Promise<FilesystemCapacity>,
): Promise<void> {
  const requiredByDevice = new Map<string, number>();
  const availableByDevice = new Map<string, number>();
  const targets = [
    { path: layout.databasePath, bytes: bytesForTarget(manifest, 'database') },
    { path: layout.publicFilesDir, bytes: bytesForTarget(manifest, 'public') },
    { path: layout.privateFilesDir, bytes: bytesForTarget(manifest, 'private') },
    { path: layout.masterSecretPath, bytes: bytesForTarget(manifest, 'secret') },
    { path: layout.derivedDataDir, bytes: 0 },
  ];
  for (const target of targets) {
    const capacity = await readCapacity(target.path);
    availableByDevice.set(capacity.deviceId, Math.min(availableByDevice.get(capacity.deviceId) ?? capacity.availableBytes, capacity.availableBytes));
    const required = await ownedBytes(target.path) + (capacity.deviceId === stageDeviceId ? 0 : target.bytes);
    requiredByDevice.set(capacity.deviceId, (requiredByDevice.get(capacity.deviceId) ?? 0) + required);
  }
  const configCapacity = await readCapacity(configuration.targetPath);
  availableByDevice.set(configCapacity.deviceId, Math.min(availableByDevice.get(configCapacity.deviceId) ?? configCapacity.availableBytes, configCapacity.availableBytes));
  requiredByDevice.set(configCapacity.deviceId, (requiredByDevice.get(configCapacity.deviceId) ?? 0) + configuration.incomingBytes + configuration.rollbackBytes);
  for (const [deviceId, requiredBytes] of requiredByDevice) if ((availableByDevice.get(deviceId) ?? -1) < requiredBytes) throw new PersonalHomeRestoreError('insufficient_space', 'Insufficient free space for Personal Home restore staging and rollback');
}

function restoredPath(layout: PersonalHomeRuntimeLayout, archivePath: string): string {
  if (archivePath === 'database/home.sqlite') return layout.databasePath;
  if (archivePath === 'secrets/handy-master-secret.txt') return layout.masterSecretPath;
  if (archivePath.startsWith('files/public/')) return join(layout.publicFilesDir, relative('files/public', archivePath));
  if (archivePath.startsWith('files/private/')) return join(layout.privateFilesDir, relative('files/private', archivePath));
  throw new PersonalHomeRestoreError('restore_failed', `Unsupported restored path: ${archivePath}`);
}
export async function assertRestoredPersonalHomeAllowlistedFilesReadable(layout: PersonalHomeRuntimeLayout, manifest: PersonalHomeRestoreResult['manifest']): Promise<void> {
  for (const entry of manifest.entries) {
    if (entry.path === 'configuration/home.env.json') continue;
    const path = restoredPath(layout, entry.path);
    await access(path, constants.R_OK);
    const handle = await open(path, 'r');
    try { await handle.read(Buffer.allocUnsafe(1), 0, 1, 0); } finally { await handle.close(); }
  }
}
