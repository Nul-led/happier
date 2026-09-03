import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { resolveRelayRuntimeDefaults } from '../relayRuntime.js';
import { applyEnvOverridesToEnvText, parseEnvText } from '../selfHostServerEnv.js';
import { readSqliteMigrationCatalog, type SqliteMigrationCatalogEntry } from '../sqliteMigrationCatalog.js';
import { resolvePersonalHomeRuntimeLayout, type PersonalHomeRuntimeLayout } from './layout.js';
import {
  createPersonalHomeOperations,
  type PersonalHomeIdentityFacts,
  type PersonalHomeOperations,
  type PersonalHomeOperationsDeps,
} from './operations.js';
import type { PersonalHomeSqliteMaintenance } from './backup.js';
import {
  PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS,
  parsePersonalHomeRestorableConfigurationV1,
  personalHomeRestorableConfigurationEnvOverrides,
  type PersonalHomeRestorableConfigurationV1,
} from './configuration.js';
import { createPersonalHomePathProtection } from './protection.js';
import { removePathDurably, replacePersonalHomeFileDurably, syncPersonalHomeFileAndParent } from './durableFile.js';
import {
  assertRestoredPersonalHomeAllowlistedFilesReadable,
  finalizePersonalHomeRestoreWithLease,
  hasMeaningfulPersonalHomeData,
  inspectPersonalHomeRestoreRecovery,
  restorePersonalHomeBackupWithLease,
} from './restore.js';
import { verifyPersonalHomeArchive } from './archive.js';
import { fingerprintMasterSecret } from './manifest.js';
import { erasePersonalHomeData } from './erase.js';
import {
  createPersonalHomeRelocationDestinationOwner,
  type PersonalHomeRelocationDestinationOwner,
} from './relocationDestination.js';
import type { IrohEndpointDescriptorV1 } from '@happier-dev/protocol';
import { IrohEndpointDescriptorV1Schema } from '@happier-dev/protocol';
import { execFileWithDeadline } from '../../process/index.js';
import {
  parsePersonalHomeAuthenticatedReadiness,
  type PersonalHomeAuthenticatedReadiness,
} from './readiness.js';
import {
  inspectPersonalHomeSqliteMigrationFrontier,
  migrateStagedPersonalHomeSqliteDatabase,
  resolveInstalledPersonalHomeSqliteMigrationPaths,
  type PersonalHomeMigrationProcessRunner,
} from './stagedMigrationFrontier.js';

function isWithin(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

export async function validateCanonicalPersonalHomeLayout(
  layout: PersonalHomeRuntimeLayout,
  trusted: Readonly<{ homeDir: string; installRoot: string; configDir: string }>,
): Promise<void> {
  if (resolve(layout.installRoot) !== resolve(trusted.installRoot) || resolve(layout.configDir) !== resolve(trusted.configDir)) {
    throw new Error('Personal Home layout is not owned by the managed runtime defaults');
  }
  if (!isWithin(layout.dataDir, layout.databasePath) || !isWithin(layout.dataDir, layout.masterSecretPath)) {
    throw new Error('Personal Home database and master secret must remain inside the canonical data root');
  }
  const roots = [layout.publicFilesDir, layout.privateFilesDir].map((path) => resolve(path));
  if (roots[0] === roots[1] || isWithin(roots[0], roots[1]) || isWithin(roots[1], roots[0])) {
    throw new Error('Personal Home public and private file roots must not overlap');
  }
  for (const unsafe of [trusted.configDir, dirname(trusted.installRoot)]) {
    if (resolve(layout.dataDir) === resolve(unsafe)) throw new Error('Unsafe Personal Home data root');
  }
  const reserved = [layout.databasePath, layout.masterSecretPath, layout.backupsDir, layout.derivedDataDir, join(layout.dataDir, 'runtime'), layout.configDir];
  for (const root of roots) {
    if (root === resolve(layout.dataDir) || root === resolve(layout.installRoot) || root === resolve(layout.configDir)) throw new Error('Unsafe Personal Home file root');
    for (const path of reserved) if (isWithin(root, path) || isWithin(path, root)) throw new Error('Personal Home file root overlaps runtime, credentials, backups, or derived data');
  }
  const homeDir = resolve(trusted.homeDir);
  const controlledRoots = [
    { target: layout.configDir, fallbackBoundary: layout.configDir },
    { target: layout.dataDir, fallbackBoundary: layout.dataDir },
    { target: layout.publicFilesDir, fallbackBoundary: isWithin(layout.dataDir, layout.publicFilesDir) ? layout.dataDir : layout.publicFilesDir },
    { target: layout.privateFilesDir, fallbackBoundary: isWithin(layout.dataDir, layout.privateFilesDir) ? layout.dataDir : layout.privateFilesDir },
  ];
  for (const { target, fallbackBoundary } of controlledRoots) {
    const boundary = isWithin(homeDir, target) ? homeDir : fallbackBoundary;
    await rejectSymbolicLinksAtOrBelowBoundary(boundary, target);
  }
}

async function rejectSymbolicLinksAtOrBelowBoundary(boundary: string, target: string): Promise<void> {
  const resolvedBoundary = resolve(boundary);
  const resolvedTarget = resolve(target);
  if (!isWithin(resolvedBoundary, resolvedTarget)) throw new Error('Personal Home path escapes its trusted boundary');
  // Platform-owned aliases above this explicit boundary are trusted; every component the caller
  // controls at or below it must remain a real directory/path rather than a link.
  const child = relative(resolvedBoundary, resolvedTarget);
  const paths = [resolvedBoundary];
  if (child) {
    let cursor = resolvedBoundary;
    for (const segment of child.split(/[\\/]+/u)) {
      cursor = join(cursor, segment);
      paths.push(cursor);
    }
  }
  for (const path of paths) {
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (info?.isSymbolicLink()) throw new Error('Personal Home path uses a symbolic-link ancestor');
  }
}

export async function resolveCanonicalPersonalHomeRuntimeLayout(params: Readonly<{
  homeDir: string;
  platform?: NodeJS.Platform;
  mode?: 'user' | 'system';
  channel?: PublicReleaseRingId;
}>): Promise<PersonalHomeRuntimeLayout> {
  const platform = params.platform ?? process.platform;
  const mode = params.mode ?? 'user';
  const channel = params.channel ?? 'stable';
  const defaults = resolveRelayRuntimeDefaults({ platform, mode, channel, homeDir: params.homeDir });
  const envPath = join(defaults.configDir, 'server.env');
  const envText = await readFile(envPath, 'utf8');
  const persisted = parseEnvText(envText);
  const layout = resolvePersonalHomeRuntimeLayout({ env: persisted, homeDir: params.homeDir, platform, mode, channel });
  await validateCanonicalPersonalHomeLayout(layout, { ...defaults, homeDir: params.homeDir });
  return layout;
}

export async function createPersonalHomeSqliteMaintenance(databasePath: string): Promise<PersonalHomeSqliteMaintenance> {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(databasePath);
  let closed = false;
  return {
    checkpoint: async () => {
      const row = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as Record<string, unknown> | undefined;
      return { busy: Number(row?.busy ?? 1) };
    },
    quickCheck: async () => {
      const row = database.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
      return Object.values(row ?? {})[0] === 'ok';
    },
    close: async () => {
      if (!closed) {
        closed = true;
        database.close();
        for (const suffix of ['-wal', '-shm']) {
          const path = `${databasePath}${suffix}`;
          const info = await stat(path).catch(() => null);
          if (info && (suffix === '-shm' || info.size === 0)) await unlink(path).catch(() => undefined);
        }
      }
    },
  };
}

export async function readPersonalHomeIdentityValueFromSqlite(databasePath: string): Promise<Pick<PersonalHomeIdentityFacts, 'homeServerIdentityId'>> {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const identity = database.prepare('SELECT value FROM SimpleCache WHERE key = ?').get('server.identity.v1') as
      | Readonly<{ value?: unknown }>
      | undefined;
    if (typeof identity?.value !== 'string' || !identity.value) throw new Error('Personal Home identity is unavailable');
    return { homeServerIdentityId: identity.value };
  } finally {
    database.close();
  }
}

export async function readPersonalHomeDataCountsFromSqlite(databasePath: string): Promise<Readonly<{ accountCount: number; sessionCount: number }>> {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const account = database.prepare('SELECT COUNT(*) AS count FROM "Account"').get() as Readonly<{ count?: unknown }> | undefined;
    const session = database.prepare('SELECT COUNT(*) AS count FROM "Session"').get() as Readonly<{ count?: unknown }> | undefined;
    const accountCount = Number(account?.count);
    const sessionCount = Number(session?.count);
    if (!Number.isSafeInteger(accountCount) || accountCount < 0 || !Number.isSafeInteger(sessionCount) || sessionCount < 0) {
      throw new Error('Personal Home account/session counts are invalid');
    }
    return { accountCount, sessionCount };
  } finally {
    database.close();
  }
}

export async function readPersonalHomeIdentityFromSqlite(
  databasePath: string,
  catalog: readonly SqliteMigrationCatalogEntry[],
): Promise<PersonalHomeIdentityFacts> {
  const [identity, frontier] = await Promise.all([
    readPersonalHomeIdentityValueFromSqlite(databasePath),
    inspectPersonalHomeSqliteMigrationFrontier({ databasePath, catalog }),
  ]);
  return { ...identity, schemaVersion: frontier.schemaVersion };
}

async function readInstalledMigrationCatalog(layout: PersonalHomeRuntimeLayout): Promise<readonly SqliteMigrationCatalogEntry[]> {
  const paths = resolveInstalledPersonalHomeSqliteMigrationPaths({ installRoot: layout.installRoot, platform: layout.platform });
  return readSqliteMigrationCatalog(paths.migrationsDir);
}

export async function readCanonicalPersonalHomeIdentity(layout: PersonalHomeRuntimeLayout, databasePath = layout.databasePath): Promise<PersonalHomeIdentityFacts> {
  return readPersonalHomeIdentityFromSqlite(databasePath, await readInstalledMigrationCatalog(layout));
}

export async function readPersonalHomeSanitizedConfiguration(layout: PersonalHomeRuntimeLayout): Promise<Record<string, string>> {
  const env = parseEnvText(await readFile(join(layout.configDir, 'server.env'), 'utf8'));
  const result: Record<string, string> = {};
  for (const [field, envKey] of Object.entries(PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS)) {
    const value = env[envKey];
    if (field === 'anonymousSignupPhase') {
      if (value !== undefined && value !== '0') throw new Error('Personal Home anonymous signup must be disabled before backup');
      if (value === '0') result[field] = 'loopback-bootstrap-then-disabled';
    } else if (typeof value === 'string' && value) result[field] = value;
  }
  if (!result.canonicalServerUrl) {
    const legacyCanonicalServerUrl = String(env.HAPPIER_PUBLIC_SERVER_URL ?? '').trim();
    if (legacyCanonicalServerUrl && String(env.HAPPIER_PUBLIC_SERVER_URL_INFERRED ?? '').trim() !== '1') {
      result.canonicalServerUrl = legacyCanonicalServerUrl;
    }
  }
  return result;
}

export async function applyPersonalHomeSanitizedConfiguration(
  layout: PersonalHomeRuntimeLayout,
  configuration: PersonalHomeRestorableConfigurationV1,
): Promise<Readonly<{ rollback(): Promise<void> }>> {
  const prepared = await preparePersonalHomeSanitizedConfiguration(layout, configuration);
  await prepared.apply();
  return { rollback: prepared.rollback };
}

export async function preparePersonalHomeSanitizedConfiguration(
  layout: PersonalHomeRuntimeLayout,
  configuration: PersonalHomeRestorableConfigurationV1,
): Promise<Readonly<{ rollbackArtifact: string; apply(): Promise<void>; rollback(): Promise<void> }>> {
  const { envPath, previous, next } = await renderPersonalHomeSanitizedConfiguration(layout, configuration);
  const id = randomUUID();
  const temporary = `${envPath}.${id}.restore.tmp`;
  const rollbackArtifact = `${envPath}.${id}.restore-rollback`;
  const protect = createPersonalHomePathProtection({ platform: layout.platform });
  await mkdir(dirname(envPath), { recursive: true });
  try {
    await writeFile(temporary, next, { mode: 0o600 });
    await protect(temporary, 'file');
    await writeFile(rollbackArtifact, previous, { mode: 0o600 });
    await protect(rollbackArtifact, 'file');
    await syncPersonalHomeFileAndParent(rollbackArtifact);
  } catch (error) {
    await Promise.all([
      rm(temporary, { force: true }).catch(() => undefined),
      rm(rollbackArtifact, { force: true }).catch(() => undefined),
    ]);
    throw error;
  }
  return {
    rollbackArtifact,
    apply: async () => { await replacePersonalHomeFileDurably(temporary, envPath); await protect(envPath, 'file'); },
    rollback: async () => recoverPersonalHomeSanitizedConfiguration(layout, rollbackArtifact),
  };
}

async function renderPersonalHomeSanitizedConfiguration(layout: PersonalHomeRuntimeLayout, configuration: PersonalHomeRestorableConfigurationV1): Promise<Readonly<{ envPath: string; previous: Buffer; next: string }>> {
  const envPath = join(layout.configDir, 'server.env'); const previous = await readFile(envPath);
  const overrides = personalHomeRestorableConfigurationEnvOverrides(
    parsePersonalHomeRestorableConfigurationV1(configuration),
  );
  const next = applyEnvOverridesToEnvText(previous.toString('utf8'), overrides);
  return { envPath, previous, next };
}

export async function inspectPersonalHomeSanitizedConfigurationStorage(layout: PersonalHomeRuntimeLayout, configuration: PersonalHomeRestorableConfigurationV1): Promise<Readonly<{ targetPath: string; incomingBytes: number; rollbackBytes: number }>> {
  const rendered = await renderPersonalHomeSanitizedConfiguration(layout, configuration);
  return { targetPath: rendered.envPath, incomingBytes: Buffer.byteLength(rendered.next), rollbackBytes: rendered.previous.byteLength };
}

export async function recoverPersonalHomeSanitizedConfiguration(layout: PersonalHomeRuntimeLayout, rollbackArtifact: string): Promise<void> {
  const envPath = join(layout.configDir, 'server.env');
  assertPersonalHomeConfigurationRollbackArtifact(envPath, rollbackArtifact);
  const previous = await readFile(rollbackArtifact);
  const temporary = `${envPath}.${randomUUID()}.rollback.tmp`;
  const protect = createPersonalHomePathProtection({ platform: layout.platform });
  await writeFile(temporary, previous, { mode: 0o600 }); await protect(temporary, 'file'); await replacePersonalHomeFileDurably(temporary, envPath); await protect(envPath, 'file');
}

function assertPersonalHomeConfigurationRollbackArtifact(envPath: string, rollbackArtifact: string): void {
  const prefix = `${envPath}.`;
  const suffix = '.restore-rollback';
  const id = rollbackArtifact.startsWith(prefix) && rollbackArtifact.endsWith(suffix)
    ? rollbackArtifact.slice(prefix.length, -suffix.length)
    : '';
  if (dirname(rollbackArtifact) !== dirname(envPath) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new Error('Invalid Personal Home configuration rollback artifact');
  }
}

export async function finalizePersonalHomeSanitizedConfiguration(layout: PersonalHomeRuntimeLayout, rollbackArtifact: string): Promise<void> {
  const envPath = join(layout.configDir, 'server.env');
  assertPersonalHomeConfigurationRollbackArtifact(envPath, rollbackArtifact);
  await removePathDurably(rollbackArtifact);
}

export async function createCanonicalPersonalHomeOperations(params: Readonly<{
  homeDir: string;
  platform?: NodeJS.Platform;
  mode?: 'user' | 'system';
  channel?: PublicReleaseRingId;
  lifecycle: PersonalHomeOperationsDeps['lifecycle'] & Readonly<{ healthCheck(): Promise<boolean> }>;
  attestActivatedHome?(): Promise<import('./readiness.js').PersonalHomeAuthenticatedReadiness>;
  readHappierVersion(): Promise<string>;
  readPurpose: PersonalHomeOperationsDeps['readPurpose'];
  runMigrationProcess?: PersonalHomeMigrationProcessRunner;
}>): Promise<PersonalHomeOperations> {
  const defaults = resolveRelayRuntimeDefaults({
    platform: params.platform ?? process.platform,
    mode: params.mode ?? 'user',
    channel: params.channel ?? 'stable',
    homeDir: params.homeDir,
  });
  return createPersonalHomeOperations({
    readPurpose: params.readPurpose,
    readIdentity: (layout) => readCanonicalPersonalHomeIdentity(layout),
    resolveLayout: () => resolveCanonicalPersonalHomeRuntimeLayout(params),
    validateLayout: (candidate) => validateCanonicalPersonalHomeLayout(candidate, { ...defaults, homeDir: params.homeDir }),
    lifecycle: params.lifecycle,
    sqliteMaintenance: createPersonalHomeSqliteMaintenance,
    ...(params.runMigrationProcess ? {
      migrateStagedDatabase: (layout, databasePath, manifest) => migrateStagedPersonalHomeSqliteDatabase({
        layout,
        databasePath,
        manifestSchemaVersion: manifest.schemaVersion,
        runProcess: params.runMigrationProcess!,
      }).then(() => undefined),
    } : {}),
    readIdentityFromDatabase: (layout, databasePath) => readCanonicalPersonalHomeIdentity(layout, databasePath),
    readDataCountsFromDatabase: (_layout, databasePath) => readPersonalHomeDataCountsFromSqlite(databasePath),
    readConfiguration: (layout) => readPersonalHomeSanitizedConfiguration(layout),
    prepareConfiguration: (layout, configuration) => preparePersonalHomeSanitizedConfiguration(layout, configuration),
    inspectConfigurationStorage: (layout, configuration) => inspectPersonalHomeSanitizedConfigurationStorage(layout, configuration),
    recoverConfiguration: (layout, artifact) => recoverPersonalHomeSanitizedConfiguration(layout, artifact),
    finalizeConfiguration: (layout, artifact) => finalizePersonalHomeSanitizedConfiguration(layout, artifact),
    ...(params.attestActivatedHome ? { attestActivatedHome: params.attestActivatedHome } : {}),
    readHappierVersion: params.readHappierVersion,
    isSchemaSupported: async (layout, schemaVersion) => (await readInstalledMigrationCatalog(layout)).some((entry) => entry.name === schemaVersion),
  });
}

/** Composes the destination-local relocation authority from the same canonical
 * layout, restore, SQLite, configuration and deletion owners used by ordinary
 * Personal Home operations. Remote coordinators never receive local paths. */
export async function createCanonicalPersonalHomeRelocationDestinationOwner(params: Readonly<{
  homeDir: string;
  platform?: NodeJS.Platform;
  mode?: 'user' | 'system';
  channel?: PublicReleaseRingId;
  quarantine(): Promise<void>;
  activate(): Promise<void>;
  readServiceStatus(): Promise<Readonly<{ running: boolean; quarantined: boolean }>>;
  attestActivatedHome(): Promise<import('./readiness.js').PersonalHomeAuthenticatedReadiness>;
  attestStagedHome(input: Readonly<{ layout: PersonalHomeRuntimeLayout }>): Promise<PersonalHomeAuthenticatedReadiness>;
  runMigrationProcess: PersonalHomeMigrationProcessRunner;
  materializeEndpoint(input: Readonly<{
    layout: PersonalHomeRuntimeLayout;
    sourceDescriptorRevision: number;
  }>): Promise<Readonly<{
    homeServerIdentityId: string;
    canonicalServerUrl: string;
    minimumOuterRevisionExclusive: number;
    endpoint?: IrohEndpointDescriptorV1;
  }>>;
}>): Promise<PersonalHomeRelocationDestinationOwner> {
  const platform = params.platform ?? process.platform;
  const mode = params.mode ?? 'user';
  const channel = params.channel ?? 'stable';
  const defaults = resolveRelayRuntimeDefaults({ platform, mode, channel, homeDir: params.homeDir });
  const initialLayout = await resolveCanonicalPersonalHomeRuntimeLayout({
    homeDir: params.homeDir,
    platform,
    mode,
    channel,
  });
  const resolveAttestedLayout = async (): Promise<PersonalHomeRuntimeLayout> => {
    const layout = await resolveCanonicalPersonalHomeRuntimeLayout({
      homeDir: params.homeDir,
      platform,
      mode,
      channel,
    });
    await validateCanonicalPersonalHomeLayout(layout, { ...defaults, homeDir: params.homeDir });
    if (JSON.stringify(layout) !== JSON.stringify(initialLayout)) {
      throw new Error('Personal Home relocation destination layout changed while the operation was pending');
    }
    return layout;
  };

  return createPersonalHomeRelocationDestinationOwner({
    dataDir: initialLayout.dataDir,
    quarantine: params.quarantine,
    readServiceStatus: params.readServiceStatus,
    activate: params.activate,
    attestActive: params.attestActivatedHome,
    stageCandidate: async (input) => {
      const layout = await resolveAttestedLayout();
      const restored = await restorePersonalHomeBackupWithLease({
        layout,
        archivePath: input.archivePath,
        operationLeaseHeld: true,
        expectedHomeServerIdentityId: input.expectedHomeServerIdentityId,
        confirmOverwrite: false,
        isSchemaSupported: async (schemaVersion) => (await readInstalledMigrationCatalog(layout)).some((entry) => entry.name === schemaVersion),
        isHomeRunning: async () => (await params.readServiceStatus()).running,
        stopHome: params.quarantine,
        sqliteMaintenance: createPersonalHomeSqliteMaintenance,
        runMigrations: async (databasePath, manifest) => await migrateStagedPersonalHomeSqliteDatabase({
          layout,
          databasePath,
          manifestSchemaVersion: manifest.schemaVersion,
          runProcess: params.runMigrationProcess,
        }).then(() => undefined),
        verifyStagedIdentity: async (databasePath, manifest) =>
          (await readCanonicalPersonalHomeIdentity(layout, databasePath)).homeServerIdentityId === manifest.homeServerIdentityId,
        prepareConfiguration: (configuration) => preparePersonalHomeSanitizedConfiguration(layout, configuration),
        inspectConfigurationStorage: (configuration) => inspectPersonalHomeSanitizedConfigurationStorage(layout, configuration),
        requireDataCountVerification: true,
        readDataCountsFromDatabase: (databasePath) => readPersonalHomeDataCountsFromSqlite(databasePath),
        verifyIdentity: async (manifest) =>
          (await readCanonicalPersonalHomeIdentity(layout)).homeServerIdentityId === manifest.homeServerIdentityId,
      });
      if (restored.outcome !== 'restored') {
        throw new Error(restored.error ?? 'Personal Home relocation destination restore failed');
      }
      const finalization = await finalizePersonalHomeRestoreWithLease({
        layout,
        operationLeaseHeld: true,
        finalizeConfiguration: (artifact) => finalizePersonalHomeSanitizedConfiguration(layout, artifact),
      });
      if (finalization.outcome !== 'finalized') {
        throw new Error(finalization.error ?? 'Personal Home relocation destination restore finalization failed');
      }
      const authenticatedReadiness = await params.attestStagedHome({ layout });
      if (authenticatedReadiness.homeServerIdentityId !== input.expectedHomeServerIdentityId) {
        throw new Error('Stopped relocation authentication attestation identity does not match the restored Home');
      }
      const endpoint = await params.materializeEndpoint({
        layout,
        sourceDescriptorRevision: input.sourceDescriptorRevision,
      });
      if (endpoint.homeServerIdentityId !== input.expectedHomeServerIdentityId) {
        throw new Error('Materialized relocation endpoint identity does not match the restored Home');
      }
      return { ...endpoint, ...authenticatedReadiness };
    },
    inspectReceivedCandidate: async (input) => {
      const layout = await resolveAttestedLayout();
      let recovery: Awaited<ReturnType<typeof inspectPersonalHomeRestoreRecovery>>;
      try {
        recovery = await inspectPersonalHomeRestoreRecovery(layout);
      } catch (error) {
        return {
          outcome: 'ambiguous',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (recovery.status === 'rollback_available' || recovery.status === 'ambiguous') {
        return {
          outcome: 'ambiguous',
          reason: `the canonical restore journal is ${recovery.status}${recovery.phase ? ` (${recovery.phase})` : ''}`,
        };
      }
      if (recovery.status === 'none' && !(await hasMeaningfulPersonalHomeData(layout))) {
        return { outcome: 'absent' };
      }

      try {
        const manifest = await verifyPersonalHomeArchive(input.archivePath);
        if (manifest.homeServerIdentityId !== input.expectedHomeServerIdentityId) {
          throw new Error('Interrupted relocation archive identity does not match the reserved Home');
        }
        if (!(await readInstalledMigrationCatalog(layout)).some((entry) => entry.name === manifest.schemaVersion)) {
          throw new Error('Interrupted relocation archive schema is not supported by this runtime');
        }
        const [identity, counts, authenticatedReadiness, configuration, secret] = await Promise.all([
          readCanonicalPersonalHomeIdentity(layout),
          readPersonalHomeDataCountsFromSqlite(layout.databasePath),
          params.attestStagedHome({ layout }),
          readPersonalHomeSanitizedConfiguration(layout),
          readFile(layout.masterSecretPath),
        ]);
        if (identity.homeServerIdentityId !== manifest.homeServerIdentityId
          || fingerprintMasterSecret(secret) !== manifest.masterSecretFingerprint
          || authenticatedReadiness.authenticated !== true
          || authenticatedReadiness.homeServerIdentityId !== manifest.homeServerIdentityId
          || authenticatedReadiness.accountCount !== counts.accountCount
          || authenticatedReadiness.sessionCount !== counts.sessionCount
          || counts.accountCount < 1 || counts.sessionCount < 0) {
          throw new Error('Interrupted relocation identity, secret, authentication, or data-count facts do not match');
        }
        const normalizedConfiguration = parsePersonalHomeRestorableConfigurationV1({
          ...configuration,
          homeServerIdentityId: identity.homeServerIdentityId,
        });
        if (normalizedConfiguration.homeServerIdentityId !== manifest.homeServerIdentityId) {
          throw new Error('Interrupted relocation configuration identity does not match');
        }
        await assertRestoredPersonalHomeAllowlistedFilesReadable(layout, manifest);
        const endpoint = await params.materializeEndpoint({
          layout,
          sourceDescriptorRevision: input.sourceDescriptorRevision,
        });
        if (endpoint.homeServerIdentityId !== manifest.homeServerIdentityId) {
          throw new Error('Interrupted relocation endpoint identity does not match the restored Home');
        }
        if (recovery.status === 'finalization_available') {
          const finalization = await finalizePersonalHomeRestoreWithLease({
            layout,
            operationLeaseHeld: true,
            finalizeConfiguration: (artifact) => finalizePersonalHomeSanitizedConfiguration(layout, artifact),
          });
          if (finalization.outcome !== 'finalized') {
            throw new Error(finalization.error ?? 'Interrupted relocation restore finalization failed');
          }
        }
        return { outcome: 'restored', ...endpoint, ...authenticatedReadiness };
      } catch (error) {
        return {
          outcome: 'ambiguous',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    abortCandidate: async () => {
      const layout = await resolveAttestedLayout();
      const erase = await erasePersonalHomeData({ layout, operationLeaseHeld: true, operation: 'relocate' });
      if (erase.outcome === 'partial') {
        throw new Error(erase.error ?? 'Personal Home relocation candidate cleanup was incomplete.');
      }
    },
  });
}

export async function attestPersonalHomeRelocationDestinationWithServerCommand(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  serverBinary: string;
  processEnv?: NodeJS.ProcessEnv;
}>): Promise<PersonalHomeAuthenticatedReadiness> {
  const envText = await readFile(join(params.layout.configDir, 'server.env'), 'utf8');
  const { stdout } = await execFileWithDeadline(params.serverBinary, [
    '--attest-personal-home-readiness',
  ], {
    env: {
      ...(params.processEnv ?? process.env),
      ...parseEnvText(envText),
      HAPPIER_SERVER_LOG_LEVEL: 'silent',
    },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  const lastLine = String(stdout).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
  let value: unknown;
  try {
    value = JSON.parse(lastLine) as unknown;
  } catch {
    throw new Error('Stopped Personal Home authentication attestation returned invalid JSON');
  }
  const readiness = parsePersonalHomeAuthenticatedReadiness(value);
  if (!readiness) throw new Error('Stopped Personal Home authentication attestation returned invalid facts');
  const identity = await readCanonicalPersonalHomeIdentity(params.layout);
  if (readiness.homeServerIdentityId !== identity.homeServerIdentityId) {
    throw new Error('Stopped Personal Home authentication attestation returned an inconsistent identity');
  }
  return readiness;
}

export async function materializePersonalHomeRelocationEndpointWithServerCommand(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  serverBinary: string;
  canonicalServerUrl: string;
  sourceDescriptorRevision: number;
  processEnv?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  homeServerIdentityId: string;
  canonicalServerUrl: string;
  minimumOuterRevisionExclusive: number;
  endpoint?: IrohEndpointDescriptorV1;
}>> {
  const envText = await readFile(join(params.layout.configDir, 'server.env'), 'utf8');
  const { stdout } = await execFileWithDeadline(params.serverBinary, [
    '--materialize-iroh-endpoint-descriptor',
    `--source-descriptor-revision=${params.sourceDescriptorRevision}`,
  ], {
    env: { ...(params.processEnv ?? process.env), ...parseEnvText(envText) },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  const value = JSON.parse(String(stdout).trim()) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stopped endpoint materialization result');
  const result = value as Record<string, unknown>;
  const identity = await readCanonicalPersonalHomeIdentity(params.layout);
  if (result.status === 'unavailable') {
    return {
      homeServerIdentityId: identity.homeServerIdentityId,
      canonicalServerUrl: params.canonicalServerUrl,
      minimumOuterRevisionExclusive: params.sourceDescriptorRevision,
    };
  }
  const endpoint = IrohEndpointDescriptorV1Schema.safeParse(result.endpoint);
  if (result.status !== 'ready' || result.homeServerIdentityId !== identity.homeServerIdentityId || !endpoint.success
    || typeof result.minimumOuterRevisionExclusive !== 'number' || !Number.isSafeInteger(result.minimumOuterRevisionExclusive)
    || result.minimumOuterRevisionExclusive < params.sourceDescriptorRevision) {
    throw new Error('Stopped endpoint materialization failed or returned inconsistent facts');
  }
  return {
    homeServerIdentityId: identity.homeServerIdentityId,
    canonicalServerUrl: params.canonicalServerUrl,
    minimumOuterRevisionExclusive: result.minimumOuterRevisionExclusive,
    endpoint: endpoint.data,
  };
}
