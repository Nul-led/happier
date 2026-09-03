import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRelayRuntimeDefaults } from '../relayRuntime.js';
import { readSqliteMigrationCatalog } from '../sqliteMigrationCatalog.js';
import { resolveInstalledPersonalHomeSqliteMigrationPaths } from './stagedMigrationFrontier.js';
import { resolvePersonalHomeRuntimeLayout } from './layout.js';
import { normalizePersonalHomeRestorableConfigurationV1 } from './configuration.js';
import {
  applyPersonalHomeSanitizedConfiguration,
  createCanonicalPersonalHomeOperations,
  createCanonicalPersonalHomeRelocationDestinationOwner,
  finalizePersonalHomeSanitizedConfiguration,
  inspectPersonalHomeSanitizedConfigurationStorage,
  preparePersonalHomeSanitizedConfiguration,
  readPersonalHomeSanitizedConfiguration,
  readPersonalHomeIdentityFromSqlite,
  readPersonalHomeDataCountsFromSqlite,
  resolveCanonicalPersonalHomeRuntimeLayout,
} from './productionAdapters.js';

/** Seeds a real managed Personal Home: persisted configuration, installed migration
 * catalog, canonical SQLite identity, master secret and local file stores. */
async function seedPersonalHome(params: Readonly<{ homeDir: string; homeServerIdentityId: string; marker: string }>) {
  const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir: params.homeDir });
  await mkdir(defaults.configDir, { recursive: true });
  await writeFile(join(defaults.configDir, 'server.env'), [
    `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`,
    'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43110',
    'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
    'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    '',
  ].join('\n'));
  const layout = await resolveCanonicalPersonalHomeRuntimeLayout({ homeDir: params.homeDir, platform: 'linux', mode: 'user' });
  const migrationPaths = resolveInstalledPersonalHomeSqliteMigrationPaths({ installRoot: layout.installRoot, platform: layout.platform });
  const migration = { name: '20260901000000_init', sql: 'CREATE TABLE relocation_fixture (id TEXT);' };
  await mkdir(join(migrationPaths.migrationsDir, migration.name), { recursive: true });
  await writeFile(join(migrationPaths.migrationsDir, migration.name, 'migration.sql'), migration.sql);
  await mkdir(layout.dataDir, { recursive: true });
  await mkdir(layout.publicFilesDir, { recursive: true });
  await mkdir(layout.privateFilesDir, { recursive: true });
  await writeFile(layout.masterSecretPath, `${params.marker}-master-secret`);
  await writeFile(join(layout.publicFilesDir, 'public.txt'), `${params.marker}-public`);
  await writeFile(join(layout.privateFilesDir, 'private.txt'), `${params.marker}-private`);
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(layout.databasePath);
  database.exec('CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  database.exec('CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT)');
  database.exec('CREATE TABLE "Account" (id TEXT PRIMARY KEY); CREATE TABLE "Session" (id TEXT PRIMARY KEY);');
  database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', params.homeServerIdentityId);
  database.prepare('INSERT INTO "Account" (id) VALUES (?)').run(`${params.marker}-account`);
  database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at) VALUES (?, ?, ?)')
    .run(migration.name, createHash('sha256').update(migration.sql).digest('hex'), '2026-01-01T00:00:00.000Z');
  database.close();
  return { defaults, layout, migrationsDir: migrationPaths.migrationsDir, schemaVersion: migration.name };
}

describe('Personal Home production adapters', () => {
  it('binds the relocation destination owner to the explicitly selected runtime target', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-relocation-target-'));
    try {
      const stable = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
      const preview = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      await mkdir(stable.configDir, { recursive: true });
      await mkdir(preview.configDir, { recursive: true });
      await writeFile(join(stable.configDir, 'server.env'), `HAPPIER_SERVER_LIGHT_DATA_DIR=${stable.dataDir}\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n`);
      await writeFile(join(preview.configDir, 'server.env'), `HAPPIER_SERVER_LIGHT_DATA_DIR=${preview.dataDir}\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n`);
      const archivePath = join(homeDir, 'bad-transfer.tar');
      await writeFile(archivePath, 'not the transferred bytes');
      const owner = await createCanonicalPersonalHomeRelocationDestinationOwner({
        homeDir,
        platform: 'linux',
        mode: 'user',
        channel: 'preview',
        quarantine: async () => undefined,
        activate: async () => undefined,
        readServiceStatus: async () => ({ running: false, quarantined: true }),
        attestActivatedHome: async () => ({ authenticated: true, homeServerIdentityId: 'srv_home_1', accountCount: 1, sessionCount: 0 }),
        attestStagedHome: async () => ({ authenticated: true, homeServerIdentityId: 'srv_home_1', accountCount: 1, sessionCount: 0 }),
        runMigrationProcess: async () => undefined,
        materializeEndpoint: async () => ({
          homeServerIdentityId: 'srv_home_1',
          canonicalServerUrl: 'https://destination.example.test',
          minimumOuterRevisionExclusive: 7,
        }),
      });
      await expect(owner.stage({
        operationId: 'operation-1',
        archivePath,
        bundleSha256: '0'.repeat(64),
        expectedHomeServerIdentityId: 'srv_home_1',
        expectedCanonicalServerUrl: 'https://source.example.test',
        sourceDescriptorRevision: 7,
      })).rejects.toMatchObject({ code: 'relocation_bundle_mismatch' });
      await expect(stat(join(preview.dataDir, '.operations', 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(stable.dataDir, '.operations'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('keeps an interrupted partial relocation restore in typed recovery with its journal intact', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-relocation-recovery-'));
    try {
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      await mkdir(defaults.configDir, { recursive: true });
      await writeFile(join(defaults.configDir, 'server.env'), `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n`);
      const archivePath = join(homeDir, 'interrupted-transfer.tar');
      const archiveBytes = Buffer.from('reserved relocation archive');
      await writeFile(archivePath, archiveBytes);
      const bundleSha256 = createHash('sha256').update(archiveBytes).digest('hex');
      const operationId = 'operation-interrupted';
      const operationsDir = join(defaults.dataDir, '.operations');
      const restoreJournalPath = join(operationsDir, 'restore-journal.json');
      await mkdir(operationsDir, { recursive: true });
      await writeFile(join(operationsDir, 'relocation-destination.json'), `${JSON.stringify({
        version: 1,
        operationId,
        status: 'receiving',
        bundleSha256,
        expectedHomeServerIdentityId: 'srv_home_1',
        expectedCanonicalServerUrl: 'https://source.example.test',
        sourceDescriptorRevision: 7,
      })}\n`);
      await writeFile(restoreJournalPath, '{"invalid":"partial restore journal"}\n');
      const owner = await createCanonicalPersonalHomeRelocationDestinationOwner({
        homeDir,
        platform: 'linux',
        mode: 'user',
        channel: 'preview',
        quarantine: async () => undefined,
        activate: async () => undefined,
        readServiceStatus: async () => ({ running: false, quarantined: true }),
        attestActivatedHome: async () => ({ authenticated: true, homeServerIdentityId: 'srv_home_1', accountCount: 1, sessionCount: 0 }),
        attestStagedHome: async () => ({ authenticated: true, homeServerIdentityId: 'srv_home_1', accountCount: 1, sessionCount: 0 }),
        runMigrationProcess: async () => undefined,
        materializeEndpoint: async () => ({
          homeServerIdentityId: 'srv_home_1',
          canonicalServerUrl: 'https://destination.example.test',
          minimumOuterRevisionExclusive: 7,
        }),
      });

      await expect(owner.stage({
        operationId,
        archivePath,
        bundleSha256,
        expectedHomeServerIdentityId: 'srv_home_1',
        expectedCanonicalServerUrl: 'https://source.example.test',
        sourceDescriptorRevision: 7,
      })).rejects.toMatchObject({ code: 'relocation_destination_recovery_required' });
      await expect(readFile(restoreJournalPath, 'utf8')).resolves.toBe('{"invalid":"partial restore journal"}\n');
      await expect(owner.status(operationId)).resolves.toMatchObject({ status: 'recovery_required' });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('never erases an unrelated destination Home when a relocation stage is refused', { timeout: 120_000 }, async () => {
    const sourceHomeDir = await mkdtemp(join(tmpdir(), 'happier-home-relocation-unrelated-source-'));
    const destinationHomeDir = await mkdtemp(join(tmpdir(), 'happier-home-relocation-unrelated-destination-'));
    try {
      await seedPersonalHome({ homeDir: sourceHomeDir, homeServerIdentityId: 'srv_home_source', marker: 'source' });
      const destination = await seedPersonalHome({ homeDir: destinationHomeDir, homeServerIdentityId: 'srv_home_unrelated', marker: 'unrelated' });
      let sourceRunning = true;
      const sourceOperations = await createCanonicalPersonalHomeOperations({
        homeDir: sourceHomeDir,
        platform: 'linux',
        mode: 'user',
        readHappierVersion: async () => '0.0.0-test',
        readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43110' }),
        lifecycle: {
          isRunning: async () => sourceRunning,
          stop: async () => { sourceRunning = false; },
          start: async () => { sourceRunning = true; },
          healthCheck: async () => true,
        },
      });
      const bundle = await sourceOperations.backup();
      expect(bundle.manifest.homeServerIdentityId).toBe('srv_home_source');

      const owner = await createCanonicalPersonalHomeRelocationDestinationOwner({
        homeDir: destinationHomeDir,
        platform: 'linux',
        mode: 'user',
        quarantine: async () => undefined,
        activate: async () => undefined,
        readServiceStatus: async () => ({ running: false, quarantined: true }),
        attestActivatedHome: async () => ({ authenticated: true, homeServerIdentityId: 'srv_home_source', accountCount: 1, sessionCount: 0 }),
        attestStagedHome: async () => ({ authenticated: true, homeServerIdentityId: 'srv_home_source', accountCount: 1, sessionCount: 0 }),
        runMigrationProcess: async () => undefined,
        materializeEndpoint: async () => ({
          homeServerIdentityId: 'srv_home_source',
          canonicalServerUrl: 'https://destination.example.test',
          minimumOuterRevisionExclusive: 4,
        }),
      });
      const stageInput = {
        operationId: 'operation-unrelated-destination',
        archivePath: bundle.path,
        bundleSha256: bundle.sha256,
        expectedHomeServerIdentityId: 'srv_home_source',
        expectedCanonicalServerUrl: 'http://127.0.0.1:43110',
        sourceDescriptorRevision: 3,
      };

      await expect(owner.stage(stageInput)).rejects.toMatchObject({ code: 'destination_not_empty' });
      await expect(owner.status(stageInput.operationId)).resolves.toMatchObject({ status: 'recovery_required' });
      await expect(owner.abort(stageInput.operationId)).resolves.toMatchObject({ status: 'recovery_required' });

      await expect(readFile(destination.layout.masterSecretPath, 'utf8')).resolves.toBe('unrelated-master-secret');
      await expect(readFile(join(destination.layout.publicFilesDir, 'public.txt'), 'utf8')).resolves.toBe('unrelated-public');
      await expect(readFile(join(destination.layout.privateFilesDir, 'private.txt'), 'utf8')).resolves.toBe('unrelated-private');
      await expect(readPersonalHomeIdentityFromSqlite(
        destination.layout.databasePath,
        await readSqliteMigrationCatalog(destination.migrationsDir),
      )).resolves.toMatchObject({ homeServerIdentityId: 'srv_home_unrelated' });
      await expect(readPersonalHomeDataCountsFromSqlite(destination.layout.databasePath)).resolves.toEqual({
        accountCount: 1,
        sessionCount: 0,
      });
    } finally {
      await rm(sourceHomeDir, { recursive: true, force: true });
      await rm(destinationHomeDir, { recursive: true, force: true });
    }
  });

  it('reads exact nonnegative Account and Session counts from the canonical SQLite database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-home-production-counts-'));
    const databasePath = join(root, 'home.sqlite');
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const database = new DatabaseSync(databasePath);
      database.exec('CREATE TABLE "Account" (id TEXT PRIMARY KEY); CREATE TABLE "Session" (id TEXT PRIMARY KEY);');
      database.prepare('INSERT INTO "Account" (id) VALUES (?)').run('account-1');
      database.prepare('INSERT INTO "Session" (id) VALUES (?)').run('session-1');
      database.prepare('INSERT INTO "Session" (id) VALUES (?)').run('session-2');
      database.close();

      await expect(readPersonalHomeDataCountsFromSqlite(databasePath)).resolves.toEqual({
        accountCount: 1,
        sessionCount: 2,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves configuration and data from the explicitly selected runtime channel', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-channel-'));
    try {
      const stable = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
      const preview = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      await mkdir(stable.configDir, { recursive: true });
      await mkdir(preview.configDir, { recursive: true });
      await writeFile(join(stable.configDir, 'server.env'), `HAPPIER_SERVER_LIGHT_DATA_DIR=${stable.dataDir}\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n`);
      await writeFile(join(preview.configDir, 'server.env'), `HAPPIER_SERVER_LIGHT_DATA_DIR=${preview.dataDir}\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n`);

      await expect(resolveCanonicalPersonalHomeRuntimeLayout({
        homeDir,
        platform: 'linux',
        mode: 'user',
        channel: 'preview',
      })).resolves.toMatchObject({
        installRoot: preview.installRoot,
        configDir: preview.configDir,
        dataDir: preview.dataDir,
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('accepts an immutable filesystem alias above the caller-controlled Home boundary', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'happier-home-production-platform-alias-'));
    const physicalPlatformRoot = join(testRoot, 'physical-platform-root');
    const platformAlias = join(testRoot, 'platform-alias');
    await mkdir(physicalPlatformRoot, { recursive: true });
    await symlink(physicalPlatformRoot, platformAlias, 'dir');
    const homeDir = join(platformAlias, 'user-home');
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
    await mkdir(defaults.configDir, { recursive: true });
    await writeFile(join(defaults.configDir, 'server.env'), [
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`,
      'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
      '',
    ].join('\n'));

    await expect(resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' })).resolves.toMatchObject({
      configDir: defaults.configDir,
      dataDir: defaults.dataDir,
    });
  });

  it('rejects a symbolic-link ancestor between the controlled Home boundary and its data root', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-controlled-link-'));
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
    const outside = await mkdtemp(join(tmpdir(), 'happier-home-production-controlled-link-outside-'));
    const linkedRoot = join(homeDir, 'linked-root');
    await symlink(outside, linkedRoot, 'dir');
    await mkdir(defaults.configDir, { recursive: true });
    await writeFile(join(defaults.configDir, 'server.env'), [
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${join(linkedRoot, 'data')}`,
      'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
      '',
    ].join('\n'));

    await expect(resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' })).rejects.toThrow(/symbolic-link ancestor/u);
  });

  it('rejects a symbolic-link config directory before erase can reach an outside server.env', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-config-link-'));
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
    const outside = join(homeDir, 'outside-config');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'server.env'), `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n`);
    await mkdir(defaults.installRoot, { recursive: true });
    await rm(defaults.configDir, { recursive: true, force: true });
    await symlink(outside, defaults.configDir, 'dir');
    await expect(resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' })).rejects.toThrow(/symbolic-link ancestor/u);
    await expect(readFile(join(outside, 'server.env'), 'utf8')).resolves.toContain('AUTH_ANONYMOUS_SIGNUP_ENABLED=0');
  });

  it('round-trips disabled anonymous signup through the semantic backup configuration value', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-config-roundtrip-'));
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
    await mkdir(defaults.configDir, { recursive: true });
    await writeFile(join(defaults.configDir, 'server.env'), [
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`,
      'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43110',
      'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
      '',
    ].join('\n'));
    const layout = await resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
    const configuration = await readPersonalHomeSanitizedConfiguration(layout);
    expect(configuration.anonymousSignupPhase).toBe('loopback-bootstrap-then-disabled');
    const applied = await applyPersonalHomeSanitizedConfiguration(layout, normalizePersonalHomeRestorableConfigurationV1(configuration, 'home-identity'));
    await expect(readFile(join(layout.configDir, 'server.env'), 'utf8')).resolves.toContain('AUTH_ANONYMOUS_SIGNUP_ENABLED=0');
    await applied.rollback();
  });

  it('reports exact configuration temporary and rollback storage for upgrade recovery preflight', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-config-storage-'));
    try {
      const layout = resolvePersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
      const envPath = join(layout.configDir, 'server.env');
      const previous = 'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43110\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n';
      await mkdir(layout.configDir, { recursive: true }); await writeFile(envPath, previous);
      const storage = await inspectPersonalHomeSanitizedConfigurationStorage(layout, normalizePersonalHomeRestorableConfigurationV1({ canonicalServerUrl: 'http://127.0.0.1:43111' }, 'home-identity'));
      expect(storage.targetPath).toBe(envPath);
      expect(storage.rollbackBytes).toBe(Buffer.byteLength(previous));
      expect(storage.incomingBytes).toBeGreaterThan(0);
    } finally { await rm(homeDir, { recursive: true, force: true }); }
  });

  it('durably finalizes the configuration rollback artifact before restore completion', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-config-finalize-'));
    try {
      const layout = resolvePersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
      const envPath = join(layout.configDir, 'server.env');
      await mkdir(layout.configDir, { recursive: true });
      await writeFile(envPath, [
        `HAPPIER_SERVER_LIGHT_DATA_DIR=${layout.dataDir}`,
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        '',
      ].join('\n'));
      const prepared = await preparePersonalHomeSanitizedConfiguration(
        layout,
        normalizePersonalHomeRestorableConfigurationV1({ canonicalServerUrl: 'http://127.0.0.1:43111' }, 'home-identity'),
      );
      await expect(readFile(prepared.rollbackArtifact)).resolves.toBeInstanceOf(Buffer);

      await finalizePersonalHomeSanitizedConfiguration(layout, prepared.rollbackArtifact);

      await expect(readFile(prepared.rollbackArtifact)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(layout.configDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
  it('rejects file roots that alias Home runtime, backup, derived, or credential paths', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-overlap-'));
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
    await mkdir(defaults.configDir, { recursive: true });
    await writeFile(join(defaults.configDir, 'server.env'), [`HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`, `HAPPIER_SERVER_LIGHT_FILES_DIR=${join(defaults.dataDir, 'backups')}`, 'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43110', ''].join('\n'));
    await expect(resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' })).rejects.toThrow(/overlaps runtime/u);
  });

  it('uses persisted server.env rather than ambient process env and applies sanitized config transactionally', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-config-'));
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
    const persistedDataDir = join(homeDir, 'persisted-data');
    await mkdir(defaults.configDir, { recursive: true });
    const originalEnv = [
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${persistedDataDir}`,
      'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43110',
      'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
      'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
      'AUTH_ANONYMOUS_SIGNUP_ENABLED=1',
      'AUTH_ANONYMOUS_SIGNUP_ENABLED=1',
      '',
    ].join('\n');
    await writeFile(join(defaults.configDir, 'server.env'), originalEnv);

    const layout = await resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
    expect(layout.dataDir).toBe(persistedDataDir);
    const applied = await applyPersonalHomeSanitizedConfiguration(layout, normalizePersonalHomeRestorableConfigurationV1({
      canonicalServerUrl: 'http://127.0.0.1:43111',
      encryptionStoragePolicy: 'plaintext_only',
      defaultAccountMode: 'plain',
      anonymousSignupPhase: 'loopback-bootstrap-then-disabled',
    }, 'home-identity'));
    await expect(readFile(join(defaults.configDir, 'server.env'), 'utf8')).resolves.toContain(
      'HAPPIER_CANONICAL_SERVER_URL=http://127.0.0.1:43111',
    );
    expect((await readFile(join(defaults.configDir, 'server.env'), 'utf8')).match(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=0$/gmu)).toHaveLength(1);
    await applied.rollback();
    await expect(readFile(join(defaults.configDir, 'server.env'), 'utf8')).resolves.toBe(originalEnv);
  });

  it('uses the same current-over-legacy persisted path precedence as the runtime layout owner', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-path-precedence-'));
    try {
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
      const currentDataDir = join(homeDir, 'current-data');
      const legacyDataDir = join(homeDir, 'legacy-data');
      await mkdir(defaults.configDir, { recursive: true });
      await writeFile(join(defaults.configDir, 'server.env'), [
        `HAPPIER_SERVER_LIGHT_DATA_DIR=${currentDataDir}`,
        `HAPPY_SERVER_LIGHT_DATA_DIR=${legacyDataDir}`,
        `HAPPIER_SERVER_LIGHT_FILES_DIR=${join(currentDataDir, 'current-public')}`,
        `HAPPY_SERVER_LIGHT_FILES_DIR=${join(legacyDataDir, 'legacy-public')}`,
        `HAPPIER_SERVER_LIGHT_PRIVATE_FILES_DIR=${join(currentDataDir, 'current-private')}`,
        `HAPPY_SERVER_LIGHT_PRIVATE_FILES_DIR=${join(legacyDataDir, 'legacy-private')}`,
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        '',
      ].join('\n'));

      const direct = resolvePersonalHomeRuntimeLayout({
        homeDir,
        platform: 'linux',
        mode: 'user',
        env: {
          HAPPIER_SERVER_LIGHT_DATA_DIR: currentDataDir,
          HAPPY_SERVER_LIGHT_DATA_DIR: legacyDataDir,
          HAPPIER_SERVER_LIGHT_FILES_DIR: join(currentDataDir, 'current-public'),
          HAPPY_SERVER_LIGHT_FILES_DIR: join(legacyDataDir, 'legacy-public'),
          HAPPIER_SERVER_LIGHT_PRIVATE_FILES_DIR: join(currentDataDir, 'current-private'),
          HAPPY_SERVER_LIGHT_PRIVATE_FILES_DIR: join(legacyDataDir, 'legacy-private'),
        },
      });
      const persisted = await resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });

      expect(persisted).toMatchObject({
        dataDir: currentDataDir,
        publicFilesDir: join(currentDataDir, 'current-public'),
        privateFilesDir: join(currentDataDir, 'current-private'),
      });
      expect(persisted).toMatchObject({
        dataDir: direct.dataDir,
        publicFilesDir: direct.publicFilesDir,
        privateFilesDir: direct.privateFilesDir,
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('reads identity/schema and backs up a real WAL SQLite database through checkpoint, quick_check, and close', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-home-production-sqlite-'));
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
    await mkdir(defaults.configDir, { recursive: true });
    await writeFile(join(defaults.configDir, 'server.env'), [
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`,
      'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43110',
      'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
      'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
      '',
    ].join('\n'));
    const layout = await resolveCanonicalPersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
    const migrationPaths = resolveInstalledPersonalHomeSqliteMigrationPaths({ installRoot: layout.installRoot, platform: layout.platform });
    const migrations = [
      { name: '20260830000000_first', sql: 'CREATE TABLE first_table (id TEXT);' },
      { name: '20260830000001_catalog_frontier', sql: 'CREATE TABLE frontier_table (id TEXT);' },
    ] as const;
    for (const migration of migrations) {
      const directory = join(migrationPaths.migrationsDir, migration.name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'migration.sql'), migration.sql);
    }
    const catalog = await readSqliteMigrationCatalog(migrationPaths.migrationsDir);
    await mkdir(layout.dataDir, { recursive: true });
    await mkdir(layout.publicFilesDir, { recursive: true });
    await mkdir(layout.privateFilesDir, { recursive: true });
    await writeFile(layout.masterSecretPath, 'master-secret');
    await writeFile(join(layout.publicFilesDir, 'public.txt'), 'public');
    await writeFile(join(layout.privateFilesDir, 'private.txt'), 'private');

    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(layout.databasePath);
    database.exec('PRAGMA journal_mode=WAL');
    database.exec('CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    database.exec('CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT)');
    database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', 'home-production');
    // Completion timestamps deliberately disagree with installed catalog order.
    database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at) VALUES (?, ?, ?)')
      .run(migrations[0].name, createHash('sha256').update(migrations[0].sql).digest('hex'), '2099-01-01T00:00:00.000Z');
    database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at) VALUES (?, ?, ?)')
      .run(migrations[1].name, createHash('sha256').update(migrations[1].sql).digest('hex'), '2000-01-01T00:00:00.000Z');
    database.close();

    await expect(readPersonalHomeIdentityFromSqlite(layout.databasePath, catalog)).resolves.toEqual({
      homeServerIdentityId: 'home-production',
      schemaVersion: migrations[1].name,
    });

    let running = true;
    const operations = await createCanonicalPersonalHomeOperations({
      homeDir,
      platform: 'linux',
      mode: 'user',
      readHappierVersion: async () => '0.0.0-test',
      readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43110' }),
      lifecycle: {
        isRunning: async () => running,
        stop: async () => { running = false; },
        start: async () => { running = true; },
        healthCheck: async () => true,
      },
    });
    const backup = await operations.backup();
    expect(backup.manifest.homeServerIdentityId).toBe('home-production');
    expect(backup.manifest.schemaVersion).toBe(migrations[1].name);
    expect(running).toBe(true);
    const wal = await stat(`${layout.databasePath}-wal`).catch(() => null);
    const shm = await stat(`${layout.databasePath}-shm`).catch(() => null);
    expect(wal === null || wal.size === 0).toBe(true);
    expect(shm === null || shm.size === 0).toBe(true);
  });
});
