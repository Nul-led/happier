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
  } catch (error) {
    await Promise.all([
      rm(temporary, { force: true }).catch(() => undefined),
      rm(rollbackArtifact, { force: true }).catch(() => undefined),
    ]);
    throw error;
  }
  return {
    rollbackArtifact,
    apply: async () => { await rename(temporary, envPath); await protect(envPath, 'file'); },
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
  await writeFile(temporary, previous, { mode: 0o600 }); await protect(temporary, 'file'); await rename(temporary, envPath); await protect(envPath, 'file'); await rm(rollbackArtifact, { force: true });
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
  await rm(rollbackArtifact, { force: true });
}

export async function createCanonicalPersonalHomeOperations(params: Readonly<{
  homeDir: string;
  platform?: NodeJS.Platform;
  mode?: 'user' | 'system';
  channel?: PublicReleaseRingId;
  lifecycle: PersonalHomeOperationsDeps['lifecycle'] & Readonly<{ healthCheck(): Promise<boolean> }>;
  readHappierVersion(): Promise<string>;
  readPurpose: PersonalHomeOperationsDeps['readPurpose'];
  runMigrationProcess?: PersonalHomeMigrationProcessRunner;
  relocation?: PersonalHomeOperationsDeps['relocation'];
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
    readConfiguration: (layout) => readPersonalHomeSanitizedConfiguration(layout),
    prepareConfiguration: (layout, configuration) => preparePersonalHomeSanitizedConfiguration(layout, configuration),
    inspectConfigurationStorage: (layout, configuration) => inspectPersonalHomeSanitizedConfigurationStorage(layout, configuration),
    recoverConfiguration: (layout, artifact) => recoverPersonalHomeSanitizedConfiguration(layout, artifact),
    finalizeConfiguration: (layout, artifact) => finalizePersonalHomeSanitizedConfiguration(layout, artifact),
    readHappierVersion: params.readHappierVersion,
    isSchemaSupported: async (layout, schemaVersion) => (await readInstalledMigrationCatalog(layout)).some((entry) => entry.name === schemaVersion),
    ...(params.relocation ? { relocation: params.relocation } : {}),
  });
}
