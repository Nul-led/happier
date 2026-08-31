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
  inspectPersonalHomeSanitizedConfigurationStorage,
  readPersonalHomeSanitizedConfiguration,
  readPersonalHomeIdentityFromSqlite,
  resolveCanonicalPersonalHomeRuntimeLayout,
} from './productionAdapters.js';

describe('Personal Home production adapters', () => {
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
      'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43111',
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
