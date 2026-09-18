import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRelayRuntimeDefaults } from '../firstPartyRuntime/relayRuntime.js';
import { resolvePersonalHomeRuntimeLayout } from '../firstPartyRuntime/personalHome/layout.js';
import { resolveInstalledPersonalHomeSqliteMigrationPaths } from '../firstPartyRuntime/personalHome/stagedMigrationFrontier.js';
import { createLocalPersonalHomeHost } from './localPersonalHomeHost.js';

// The RelayHostEngine is the host-owned service/process boundary this composition
// exists to sit on top of, so it is the only thing stubbed here. Every Personal
// Home owner below the composition (layout resolution, operations, lifecycle
// policy, relocation destination) runs for real against a temporary Home.
type EngineStub = Readonly<{
  readStatus: ReturnType<typeof vi.fn>;
  installOrUpdate: ReturnType<typeof vi.fn>;
  control: ReturnType<typeof vi.fn>;
}>;

let homeDir: string;
let canonicalServerUrl: string;

function statusSnapshot() {
  return {
    installed: true,
    version: 'happier-server-v9',
    service: { active: false, enabled: true },
    baseUrl: canonicalServerUrl,
    healthy: true,
    canonicalServerUrl,
    purpose: { kind: 'personal-home' as const, canonicalServerUrl },
  };
}

function createEngine(): EngineStub {
  return {
    readStatus: vi.fn(async () => statusSnapshot()),
    installOrUpdate: vi.fn(async () => ({ relayUrl: canonicalServerUrl, mode: 'user' as const })),
    control: vi.fn(async () => undefined),
  };
}

function createHost(engine: EngineStub, overrides: Partial<{ channel: 'stable' | 'preview' | 'dev'; mode: 'user' | 'system' }> = {}) {
  return createLocalPersonalHomeHost({
    engine: engine as never,
    homeDir,
    channel: overrides.channel ?? 'stable',
    mode: overrides.mode ?? 'user',
  });
}

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'local-personal-home-host-'));
  canonicalServerUrl = 'http://127.0.0.1:43123';
  const defaults = resolveRelayRuntimeDefaults({ homeDir, mode: 'user', channel: 'stable' });
  await mkdir(defaults.configDir, { recursive: true });
  await mkdir(defaults.dataDir, { recursive: true });
  await writeFile(join(defaults.configDir, 'server.env'), [
    'HAPPIER_SERVER_HOST=127.0.0.1',
    'PORT=43123',
    `HAPPIER_CANONICAL_SERVER_URL=${canonicalServerUrl}`,
    'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
    'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
    '',
  ].join('\n'));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('local Personal Home host composition', () => {
  it('drives the canonical Personal Home operations owner from the host engine snapshot', async () => {
    const engine = createEngine();
    const operations = await createHost(engine).createOperations();

    await expect(operations.inspect({ expectedCanonicalServerUrl: canonicalServerUrl })).resolves.toMatchObject({
      purpose: 'personal-home',
      canonicalServerUrl,
      running: false,
    });
    expect(engine.readStatus).toHaveBeenCalledWith({
      target: { kind: 'local' },
      channel: 'stable',
      mode: 'user',
    });
  });

  it('requires a fresh personal-home runtime purpose before any operation touches the Home', async () => {
    const engine = createEngine();
    engine.readStatus.mockResolvedValue({ ...statusSnapshot(), purpose: { kind: 'generic' } });
    const operations = await createHost(engine).createOperations();

    await expect(operations.inspect({ expectedCanonicalServerUrl: canonicalServerUrl }))
      .rejects.toMatchObject({ code: 'purpose_not_personal_home' });
  });

  it('composes the relocation destination owner against the same layout and release ring', async () => {
    const engine = createEngine();
    const host = createHost(engine);

    expect(host.releaseRing).toBe('stable');
    await expect(host.createRelocationDestinationOwner()).resolves.toEqual(expect.objectContaining({
      stage: expect.any(Function),
    }));
  });

  it('normalizes the public channel label onto one release ring for the whole composition', () => {
    expect(createHost(createEngine(), { channel: 'dev' }).releaseRing).toBe('publicdev');
    expect(createHost(createEngine(), { channel: 'preview' }).releaseRing).toBe('preview');
    expect(createHost(createEngine()).releaseRing).toBe('stable');
  });

  it('clears startup readiness from the persisted Personal Home data root when backup restarts an overridden layout', async () => {
    const defaults = resolveRelayRuntimeDefaults({ homeDir, mode: 'user', channel: 'stable' });
    const customDataDir = join(homeDir, 'external-personal-home-data');
    await writeFile(join(defaults.configDir, 'server.env'), [
      'HAPPIER_SERVER_HOST=127.0.0.1',
      'PORT=43123',
      `HAPPIER_CANONICAL_SERVER_URL=${canonicalServerUrl}`,
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${customDataDir}`,
      'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
      'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
      'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
      '',
    ].join('\n'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir,
      mode: 'user',
      channel: 'stable',
      env: { HAPPIER_SERVER_LIGHT_DATA_DIR: customDataDir },
    });
    await mkdir(layout.publicFilesDir, { recursive: true });
    await mkdir(layout.privateFilesDir, { recursive: true });
    const migrationPaths = resolveInstalledPersonalHomeSqliteMigrationPaths({
      installRoot: layout.installRoot,
      platform: layout.platform,
    });
    await mkdir(join(migrationPaths.migrationsDir, '20260901000000_init'), { recursive: true });
    const migrationSql = 'CREATE TABLE bootstrap_fixture (id TEXT);';
    await writeFile(join(migrationPaths.migrationsDir, '20260901000000_init', 'migration.sql'), migrationSql);
    await writeFile(layout.masterSecretPath, 'personal-home-secret');
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(layout.databasePath);
    database.exec('CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    database.exec('CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT)');
    database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', 'srv_custom_layout');
    database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at) VALUES (?, ?, ?)')
      .run('20260901000000_init', createHash('sha256').update(migrationSql).digest('hex'), '2026-01-01T00:00:00.000Z');
    database.close();

    const defaultReceipt = join(defaults.dataDir, 'startup-receipt.json');
    const customReceipt = join(customDataDir, 'startup-receipt.json');
    await mkdir(defaults.dataDir, { recursive: true });
    await writeFile(defaultReceipt, 'default receipt must remain');
    await writeFile(customReceipt, 'stale custom receipt');

    let running = true;
    const engine = createEngine();
    engine.readStatus.mockImplementation(async () => ({
      ...statusSnapshot(),
      service: { active: running, enabled: true },
      layout,
    }));
    engine.control.mockImplementation(async ({ action }: { action: string }) => {
      if (action === 'stop') running = false;
      if (action === 'start') running = true;
    });

    const operations = await createHost(engine).createOperations();
    await operations.backup({ outputPath: join(homeDir, 'backup.tar') });

    await expect(access(customReceipt)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(defaultReceipt)).resolves.toBeUndefined();
  });
});
