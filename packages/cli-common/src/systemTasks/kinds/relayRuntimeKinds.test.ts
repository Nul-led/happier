import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { SYSTEM_TASK_PROTOCOL_VERSION } from '@happier-dev/protocol';

import { createPersonalHomeOperations } from '../../firstPartyRuntime/personalHome/operations.js';
import { createPersonalHomeBackup } from '../../firstPartyRuntime/personalHome/backup.js';
import { serializePersonalHomeManifest, type PersonalHomeBackupManifestV1 } from '../../firstPartyRuntime/personalHome/manifest.js';
import { resolvePersonalHomeRuntimeLayout } from '../../firstPartyRuntime/personalHome/layout.js';
import { resolveRelayRuntimeDefaults } from '../../firstPartyRuntime/relayRuntime.js';
import { readSqliteMigrationCatalog } from '../../firstPartyRuntime/sqliteMigrationCatalog.js';
import { resolveInstalledPersonalHomeSqliteMigrationPaths } from '../../firstPartyRuntime/personalHome/stagedMigrationFrontier.js';
import { createCanonicalPersonalHomeOperations } from '../../firstPartyRuntime/personalHome/productionAdapters.js';
import {
  createPersonalHomeBackupTaskKind,
  createDeferredPersonalHomeSystemTaskOperations,
  createPersonalHomeEraseTaskKind,
  createPersonalHomeInspectTaskKind,
  createPersonalHomeRelocationDestinationAbortTaskKind,
  createPersonalHomeRelocationDestinationCommitTaskKind,
  createPersonalHomeRelocationDestinationStageTaskKind,
  createPersonalHomeRelocationDestinationStatusTaskKind,
  createPersonalHomeRestoreTaskKind,
  createPersonalHomeVerifyBackupTaskKind,
  createPersonalHomeSystemTaskOperations,
  createPersonalHomeRestoreContactReconciler,
  PERSONAL_HOME_SYSTEM_TASK_KINDS,
  PERSONAL_HOME_SYSTEM_TASK_KIND_IDS,
  createRelayRuntimeInstallOrUpdateTaskKind,
  createRelayRuntimeStartTaskKind,
  createRelayRuntimeStatusTaskKind,
  createRelayRuntimeStopTaskKind,
  createRelayRuntimeUninstallTaskKind,
  parseSystemTaskSshConfig,
  type PersonalHomeSystemTaskOperations,
} from './relayRuntimeKinds.js';
import { createExecutionRunnerFromKind } from '../createExecutionRunnerFromKind.js';
import { createSystemTaskRegistry, executeSystemTask } from '../runSystemTask.js';

async function seedActivatingCanonicalHome(params: Readonly<{ validReadiness: boolean }>) {
  const homeDir = await mkdtemp(join(tmpdir(), 'happier-restore-contact-root-'));
  const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
  await mkdir(defaults.configDir, { recursive: true });
  await writeFile(join(defaults.configDir, 'server.env'), [
    `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`,
    'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43123',
    'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
    'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    '',
  ].join('\n'));
  const layout = resolvePersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user', channel: 'preview' });
  const migrationPaths = resolveInstalledPersonalHomeSqliteMigrationPaths({ installRoot: layout.installRoot, platform: layout.platform });
  const migration = { name: '20260831000000_restore_contact', sql: 'CREATE TABLE restore_contact (id TEXT);' };
  await mkdir(join(migrationPaths.migrationsDir, migration.name), { recursive: true });
  await writeFile(join(migrationPaths.migrationsDir, migration.name, 'migration.sql'), migration.sql);
  const catalog = await readSqliteMigrationCatalog(migrationPaths.migrationsDir);
  await mkdir(layout.dataDir, { recursive: true });
  await mkdir(layout.publicFilesDir, { recursive: true });
  await mkdir(layout.privateFilesDir, { recursive: true });
  await writeFile(layout.masterSecretPath, 'restore-contact-secret');
  await writeFile(join(layout.publicFilesDir, 'public.txt'), 'public');
  await writeFile(join(layout.privateFilesDir, 'private.txt'), 'private');
  const database = new DatabaseSync(layout.databasePath);
  database.exec('CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT); CREATE TABLE "Account" (id TEXT PRIMARY KEY); CREATE TABLE "Session" (id TEXT PRIMARY KEY);');
  database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', 'restore-contact-home');
  database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at) VALUES (?, ?, ?)').run(migration.name, createHash('sha256').update(migration.sql).digest('hex'), '2026-08-31T00:00:00.000Z');
  database.prepare('INSERT INTO "Account" (id) VALUES (?)').run('account-1');
  database.prepare('INSERT INTO "Session" (id) VALUES (?)').run('session-1');
  database.close();
  const schemaVersion = catalog.at(-1)?.name;
  if (!schemaVersion) throw new Error('Test migration catalog is empty');

  let running = true;
  const operations = await createCanonicalPersonalHomeOperations({
    homeDir,
    platform: 'linux',
    mode: 'user',
    channel: 'preview',
    readHappierVersion: async () => '0.0.0-test',
    readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }),
    lifecycle: {
      isRunning: async () => running,
      stop: async () => { running = false; },
      start: async () => { running = true; },
      healthCheck: async () => true,
    },
    attestActivatedHome: async () => ({
      authenticated: true,
      homeServerIdentityId: 'restore-contact-home',
      accountCount: params.validReadiness ? 1 : 2,
      sessionCount: 1,
    }),
  });
  const backup = await createPersonalHomeBackup({
    layout,
    outputPath: join(layout.backupsDir, 'restore-contact.tar'),
    stagingDir: join(homeDir, 'backup-staging'),
    homeServerIdentityId: 'restore-contact-home',
    schemaVersion,
    happierVersion: '0.0.0-test',
    configuration: {},
    sqlite: {
      checkpoint: async () => ({ busy: 0 }),
      quickCheck: async () => true,
      close: async () => undefined,
    },
  });
  const id = '00000000-0000-4000-8000-000000000071';
  const stage = `${layout.dataDir}.restore-stage-${process.pid}-${id}`;
  const artifact = join(layout.configDir, `server.env.${id}.restore-rollback`);
  const entries = [
    [layout.databasePath, join(stage, 'database/home.sqlite')],
    [layout.publicFilesDir, join(stage, 'files/public')],
    [layout.privateFilesDir, join(stage, 'files/private')],
    [layout.masterSecretPath, join(stage, 'secrets/handy-master-secret.txt')],
    [layout.derivedDataDir, join(stage, 'derived')],
  ].map(([target, source], index) => ({
    target,
    source,
    rollback: `${target}.restore-rollback-${id}`,
    hadTarget: index === 0,
    state: index < 4 ? 'promoted' : 'untouched',
  }));
  await mkdir(join(layout.dataDir, '.operations'), { recursive: true });
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, 'manifest.json'), serializePersonalHomeManifest(backup.manifest as PersonalHomeBackupManifestV1));
  await writeFile(artifact, 'previous-config');
  await writeFile(entries[0]!.rollback, 'previous-database');
  const journalPath = join(layout.dataDir, '.operations', 'restore-journal.json');
  await writeFile(journalPath, `${JSON.stringify({
    version: 2,
    phase: 'activating',
    stage,
    wasRunning: true,
    configurationRollbackArtifact: artifact,
    configurationRollbackState: 'pending',
    entries,
  })}\n`);
  return { homeDir, layout, operations, journalPath, stage, artifact, rollbackPath: entries[0]!.rollback, running: () => running };
}

describe('relay runtime shared system task kinds', () => {
  it('does not treat a requested Personal Home purpose as an existing restore contact on a fresh install', async () => {
    const reconcileRestore = vi.fn(async () => undefined);
    const reconcileContact = createPersonalHomeRestoreContactReconciler({
      readStatus: async () => ({
        installed: false,
        version: null,
        service: { active: null, enabled: null },
        baseUrl: 'http://127.0.0.1:43123',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        dataPresent: false,
      }),
      operations: {
        inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}),
        restore: async () => ({}), reconcileRestore, recoverRestore: async () => ({}), erase: async () => ({}),
      },
    });

    await reconcileContact({
      target: { kind: 'local' },
      channel: 'preview',
      mode: 'user',
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
    }, { progress: () => undefined });

    expect(reconcileRestore).not.toHaveBeenCalled();
  });

  it.each([
    { installed: true, dataPresent: false, label: 'installed runtime' },
    { installed: false, dataPresent: true, label: 'retained Home data' },
  ])('reconciles an existing Personal Home contact with $label', async ({ installed, dataPresent }) => {
    const reconcileRestore = vi.fn(async () => undefined);
    const reconcileContact = createPersonalHomeRestoreContactReconciler({
      readStatus: async () => ({
        installed,
        version: installed ? '1.0.0' : null,
        service: { active: false, enabled: false },
        baseUrl: 'http://127.0.0.1:43123',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        dataPresent,
      }),
      operations: {
        inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}),
        restore: async () => ({}), reconcileRestore, recoverRestore: async () => ({}), erase: async () => ({}),
      },
    });

    await reconcileContact({
      target: { kind: 'local' },
      channel: 'preview',
      mode: 'user',
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
    }, { progress: () => undefined });

    expect(reconcileRestore).toHaveBeenCalledOnce();
  });

  it('finalizes a real activating restore journal through the shared runtime-contact root', { timeout: 60_000 }, async () => {
    const fixture = await seedActivatingCanonicalHome({ validReadiness: true });
    try {
      const reconcileContact = createPersonalHomeRestoreContactReconciler({
        readStatus: async () => ({
          installed: true,
          version: '0.0.0-test',
          service: { active: true, enabled: true },
          baseUrl: 'http://127.0.0.1:43123',
          healthy: true,
          purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        }),
        operations: createPersonalHomeSystemTaskOperations({ operations: fixture.operations }),
      });

      await reconcileContact({
        target: { kind: 'local' },
        channel: 'preview',
        mode: 'user',
      }, { progress: () => undefined });

      expect(fixture.running()).toBe(true);
      await expect(stat(fixture.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(fixture.stage)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(fixture.artifact)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(fixture.rollbackPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fixture.operations.inspect()).resolves.toMatchObject({ restoreRecovery: { status: 'none' } });
    } finally {
      await rm(fixture.homeDir, { recursive: true, force: true });
    }
  });

  it('stops and retains an invalid activating restore candidate through the shared runtime-contact root', { timeout: 60_000 }, async () => {
    const fixture = await seedActivatingCanonicalHome({ validReadiness: false });
    try {
      const reconcileContact = createPersonalHomeRestoreContactReconciler({
        readStatus: async () => ({
          installed: true,
          version: '0.0.0-test',
          service: { active: true, enabled: true },
          baseUrl: 'http://127.0.0.1:43123',
          healthy: true,
          purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        }),
        operations: createPersonalHomeSystemTaskOperations({ operations: fixture.operations }),
      });

      await expect(reconcileContact({
        target: { kind: 'local' },
        channel: 'preview',
        mode: 'user',
      }, { progress: () => undefined })).rejects.toMatchObject({ code: 'restore_recovery_required' });

      expect(fixture.running()).toBe(false);
      await expect(stat(fixture.journalPath)).resolves.toBeTruthy();
      await expect(stat(fixture.stage)).resolves.toBeTruthy();
      await expect(stat(fixture.artifact)).resolves.toBeTruthy();
      await expect(stat(fixture.rollbackPath)).resolves.toBeTruthy();
      await expect(fixture.operations.inspect()).resolves.toMatchObject({
        restoreRecovery: { status: 'rollback_available', phase: 'activating' },
      });
    } finally {
      await rm(fixture.homeDir, { recursive: true, force: true });
    }
  });

  it('routes retry-safe relocation destination actions through one destination-local owner', async () => {
    const calls: string[] = [];
    const relocationDestination = {
      stage: async () => (calls.push('stage'), { operationId: 'operation-1', status: 'quarantined' as const, bundleSha256: 'a'.repeat(64), expectedHomeServerIdentityId: 'home-1', expectedCanonicalServerUrl: 'https://source.example.test', sourceDescriptorRevision: 1 }),
      status: async () => (calls.push('status'), { operationId: 'operation-1', status: 'quarantined' as const, bundleSha256: 'a'.repeat(64), expectedHomeServerIdentityId: 'home-1', expectedCanonicalServerUrl: 'https://source.example.test', sourceDescriptorRevision: 1 }),
      commit: async () => (calls.push('commit'), { operationId: 'operation-1', status: 'active' as const, bundleSha256: 'a'.repeat(64), expectedHomeServerIdentityId: 'home-1', expectedCanonicalServerUrl: 'https://source.example.test', sourceDescriptorRevision: 1 }),
      abort: async () => (calls.push('abort'), { operationId: 'operation-1', status: 'aborted' as const, bundleSha256: 'a'.repeat(64), expectedHomeServerIdentityId: 'home-1', expectedCanonicalServerUrl: 'https://source.example.test', sourceDescriptorRevision: 1 }),
    };
    const base = {
      target: { kind: 'local' as const },
      channel: 'stable' as const,
      mode: 'user' as const,
      purpose: { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' },
      operationId: 'operation-1',
    };
    const cases = [
      [createPersonalHomeRelocationDestinationStageTaskKind, { ...base, archivePath: '/tmp/bundle.tar', bundleSha256: 'a'.repeat(64), expectedHomeServerIdentityId: 'home-1', expectedCanonicalServerUrl: 'https://source.example.test', sourceDescriptorRevision: 1 }],
      [createPersonalHomeRelocationDestinationStatusTaskKind, base],
      [createPersonalHomeRelocationDestinationCommitTaskKind, { ...base, publishedDescriptor: { v: 1, homeServerIdentityId: 'srv_home_1', canonicalServerUrl: 'https://destination.example.test', revision: 2, endpoints: [{ kind: 'https', url: 'https://destination.example.test' }] } }],
      [createPersonalHomeRelocationDestinationAbortTaskKind, base],
    ] as const;
    for (const [factory, params] of cases) {
      await expect(factory({ loadRelocationDestination: async (target) => {
        expect(target).toEqual({ channel: 'stable', mode: 'user' });
        return relocationDestination;
      } }).run({ params, emit: () => undefined, prompt: async () => undefined })).resolves.toHaveProperty('status');
    }
    expect(calls).toEqual(['stage', 'status', 'commit', 'abort']);
  });

  it('carries the exact Personal Home runtime target to the operation owner', async () => {
    let receivedContext: unknown;
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async (context) => (receivedContext = context, {}),
      backup: async () => ({}),
      verifyBackup: async () => ({}),
      restore: async () => ({}),
      reconcileRestore: async () => undefined,
      recoverRestore: async () => ({}),
      erase: async () => ({}),
    };

    await createPersonalHomeInspectTaskKind({ operations }).run({
      params: {
        target: { kind: 'local' },
        channel: 'preview',
        mode: 'system',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      },
      emit: () => undefined,
      prompt: async () => undefined,
    });

    expect(receivedContext).toMatchObject({
      runtimeTarget: { channel: 'preview', mode: 'system' },
    });
  });

  it('routes interrupted restore recovery and rejects the removed finalization action', async () => {
    const recoverRestore = vi.fn(async () => ({ outcome: 'rolled_back', affectedTargets: ['/home/data'] }));
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}),
      restore: async () => ({}), reconcileRestore: async () => undefined, recoverRestore, erase: async () => ({}),
    };
    const result = await createPersonalHomeRestoreTaskKind({ operations }).run({
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        action: 'recover',
      },
      emit: () => undefined,
      prompt: async () => ({}),
    });
    expect(result).toEqual({ outcome: 'rolled_back', affectedTargets: ['/home/data'] });
    expect(recoverRestore).toHaveBeenCalledOnce();

    await expect(createPersonalHomeRestoreTaskKind({ operations }).run({
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        action: 'finalize',
      },
      emit: () => undefined,
      prompt: async () => ({}),
    })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(recoverRestore).toHaveBeenCalledOnce();
    expect(PERSONAL_HOME_SYSTEM_TASK_KIND_IDS).not.toContain('relay.runtime.personal_home.finalize_restore.v1');
    expect(PERSONAL_HOME_SYSTEM_TASK_KIND_IDS).toHaveLength(9);
  });
  it('derives the five local Personal Home operations from their task kinds', async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => (calls.push(['inspect', undefined]), { operation: 'inspect' }),
      backup: async (input) => (calls.push(['backup', input]), { operation: 'backup' }),
      verifyBackup: async (input) => (calls.push(['verify_backup', input]), { operation: 'verify_backup' }),
      restore: async (input) => (calls.push(['restore', input]), { operation: 'restore' }),
      reconcileRestore: async () => undefined,
      recoverRestore: async () => ({ operation: 'recover_restore' }),
      erase: async (input) => (calls.push(['erase', input]), { operation: 'erase' }),
    };
    const base = {
      target: { kind: 'local' as const },
      channel: 'stable' as const,
      mode: 'user' as const,
      purpose: { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' },
    };
    const cases = [
      [createPersonalHomeInspectTaskKind, base],
      [createPersonalHomeBackupTaskKind, { ...base, outputPath: '/tmp/home.tar' }],
      [createPersonalHomeVerifyBackupTaskKind, { ...base, archivePath: '/tmp/home.tar' }],
      [createPersonalHomeRestoreTaskKind, { ...base, archivePath: '/tmp/home.tar', confirmOverwrite: true, expectedHomeServerIdentityId: 'home_1' }],
      [createPersonalHomeEraseTaskKind, base],
    ] as const;

    for (const [factory, params] of cases) {
      const result = await factory({ operations }).run({
        params,
        emit: () => undefined,
        prompt: async () => ({ confirmed: true }),
      });
      expect(result).toHaveProperty('operation');
    }

    expect(calls.map(([operation]) => operation)).toEqual([
      'inspect', 'backup', 'verify_backup', 'restore', 'erase',
    ]);
  });

  it.each([
    ['inspect', createPersonalHomeInspectTaskKind, { unexpected: true }],
    ['backup', createPersonalHomeBackupTaskKind, { operation: 'backup' }],
    ['verify backup', createPersonalHomeVerifyBackupTaskKind, {}],
    ['restore', createPersonalHomeRestoreTaskKind, { archivePath: '/tmp/home.tar', confirmOverwrite: false }],
    ['erase', createPersonalHomeEraseTaskKind, { confirmErase: false }],
  ])('rejects invalid %s params before invoking the owner', async (_label, factory, extra) => {
    let calls = 0;
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => (calls += 1, {}),
      backup: async () => (calls += 1, {}),
      verifyBackup: async () => (calls += 1, {}),
      restore: async () => (calls += 1, {}),
      reconcileRestore: async () => undefined,
      recoverRestore: async () => (calls += 1, {}),
      erase: async () => (calls += 1, {}),
    };

    await expect(factory({ operations }).run({
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        ...extra,
      },
      emit: () => undefined,
      prompt: async () => undefined,
    })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(calls).toBe(0);
  });

  it.each([
    ['false', { confirmed: false }],
    ['malformed', { confirmed: true, extra: true }],
    ['non-object', true],
  ])('does not authorize erase for a %s prompt answer', async (_label, answer) => {
    let confirmed = false;
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}), restore: async () => ({}), reconcileRestore: async () => undefined, recoverRestore: async () => ({}),
      erase: async (context) => {
        confirmed = await context.confirm!({ canonicalServerUrl: 'http://127.0.0.1:43123', homeServerIdentityId: 'home-1', paths: ['/data/home.sqlite'], estimatedBytes: 42 });
        if (!confirmed) throw Object.assign(new Error('declined'), { code: 'confirmation_required' });
        return {};
      },
    };
    await expect(createPersonalHomeEraseTaskKind({ operations }).run({
      params: { target: { kind: 'local' }, channel: 'stable', mode: 'user', purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' } },
      emit: () => undefined,
      prompt: async () => answer,
    })).rejects.toBeTruthy();
    expect(confirmed).toBe(false);
  });

  it('emits the owner-resolved erase prompt and accepts only the narrow approval shape', async () => {
    const prompts: unknown[] = [];
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}), restore: async () => ({}), reconcileRestore: async () => undefined, recoverRestore: async () => ({}),
      erase: async (context) => ({ confirmed: await context.confirm!({ canonicalServerUrl: 'http://127.0.0.1:43123', homeServerIdentityId: 'home-1', paths: ['/canonical/home.sqlite'], estimatedBytes: 73 }) }),
    };
    await expect(createPersonalHomeEraseTaskKind({ operations }).run({
      params: { target: { kind: 'local' }, channel: 'stable', mode: 'user', purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' } },
      emit: () => undefined,
      prompt: async (prompt) => { prompts.push(prompt); return { confirmed: true }; },
    })).resolves.toEqual({ confirmed: true });
    expect(prompts).toEqual([{
      kind: 'personal_home.confirm_erase.v1',
      stepId: 'personal_home.confirm_erase',
      message: 'Confirm permanent deletion of these Personal Home paths.',
      data: { canonicalServerUrl: 'http://127.0.0.1:43123', homeServerIdentityId: 'home-1', paths: ['/canonical/home.sqlite'], estimatedBytes: 73 },
    }]);
  });

  it('rejects SSH before progress or an owner call', async () => {
    let calls = 0;
    const events: unknown[] = [];
    const kind = createPersonalHomeInspectTaskKind({
      operations: {
        inspect: async () => (calls += 1, {}),
        backup: async () => ({}),
        verifyBackup: async () => ({}),
        restore: async () => ({}),
        reconcileRestore: async () => undefined,
        recoverRestore: async () => ({}),
        erase: async () => ({}),
      },
    });

    await expect(kind.run({
      params: {
        target: { kind: 'ssh', ssh: { target: 'host.example', auth: 'agent' } },
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      },
      emit: (event) => events.push(event),
      prompt: async () => undefined,
    })).rejects.toMatchObject({ code: 'unsupported' });
    expect(events).toEqual([]);
    expect(calls).toBe(0);
  });

  it('allows restore without overwrite confirmation and forwards the absence to the owner', async () => {
    let restoreInput: unknown;
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({}),
      backup: async () => ({}),
      verifyBackup: async () => ({}),
      restore: async (input) => (restoreInput = input, {}),
      reconcileRestore: async () => undefined,
      recoverRestore: async () => ({}),
      erase: async () => ({}),
    };

    await expect(createPersonalHomeRestoreTaskKind({ operations }).run({
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        archivePath: '/tmp/home.tar',
      },
      emit: () => undefined,
      prompt: async () => undefined,
    })).resolves.toEqual({});
    expect(restoreInput).toMatchObject({ archivePath: '/tmp/home.tar' });
    expect(restoreInput).not.toHaveProperty('confirmOverwrite');
  });

  it('retries deferred owner composition after a failed load and caches the successful owner', async () => {
    let loads = 0;
    const targets: unknown[] = [];
    const owner: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({ ready: true }),
      backup: async () => ({}),
      verifyBackup: async () => ({}),
      restore: async () => ({}),
      reconcileRestore: async () => undefined,
      recoverRestore: async () => ({}),
      erase: async () => ({}),
    };
    const operations = createDeferredPersonalHomeSystemTaskOperations(async (target) => {
      loads += 1;
      targets.push(target);
      if (loads === 1) throw new Error('runtime not installed');
      return owner;
    });
    const context = {
      requestedPurpose: { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' },
      runtimeTarget: { channel: 'stable' as const, mode: 'user' as const },
      progress: () => undefined,
      confirm: async () => true,
    };

    await expect(operations.inspect(context)).rejects.toThrow('runtime not installed');
    await expect(operations.inspect(context)).resolves.toEqual({ ready: true });
    await expect(operations.inspect(context)).resolves.toEqual({ ready: true });
    await expect(operations.inspect({
      ...context,
      runtimeTarget: { channel: 'preview', mode: 'user' },
    })).resolves.toEqual({ ready: true });
    expect(loads).toBe(3);
    expect(targets).toEqual([
      { channel: 'stable', mode: 'user' },
      { channel: 'stable', mode: 'user' },
      { channel: 'preview', mode: 'user' },
    ]);
  });

  it('forwards cancellation and emits only owner-reported progress phases', async () => {
    const controller = new AbortController();
    const events: unknown[] = [];
    const kind = createPersonalHomeBackupTaskKind({
      operations: {
        inspect: async () => ({}),
        backup: async (input) => {
          expect(input.signal).toBe(controller.signal);
          input.progress('checkpointing', 'Checkpointing Personal Home database');
          return { verified: true };
        },
        verifyBackup: async () => ({}),
        restore: async () => ({}),
        reconcileRestore: async () => undefined,
        recoverRestore: async () => ({}),
        erase: async () => ({}),
      },
    });

    await expect(kind.run({
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      },
      signal: controller.signal,
      emit: (event) => events.push(event),
      prompt: async () => undefined,
    })).resolves.toEqual({ verified: true });
    expect(events).toEqual([{
      type: 'progress',
      stepId: 'personal_home.checkpointing',
      message: 'Checkpointing Personal Home database',
    }]);
  });

  it('composes an inspect task through the canonical PersonalHomeOperations facade', async () => {
    const homeDir = join(tmpdir(), `happier-task-compose-${Date.now()}`);
    const facade = createPersonalHomeOperations({
      readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }),
      readIdentity: async () => ({ homeServerIdentityId: 'home_1', schemaVersion: '1' }),
      resolveLayout: async () => resolvePersonalHomeRuntimeLayout({
        homeDir,
        platform: 'linux',
        mode: 'user',
      }),
      validateLayout: async () => undefined,
      lifecycle: {
        isRunning: async () => false,
        stop: async () => undefined,
        start: async () => undefined,
      },
      sqliteMaintenance: async () => ({
        checkpoint: async () => ({ busy: 0 }),
        quickCheck: async () => true,
        close: async () => undefined,
      }),
      readConfiguration: async () => ({}),
      prepareConfiguration: async () => ({ rollbackArtifact: '/tmp/config.rollback', apply: async () => undefined, rollback: async () => undefined }),
      recoverConfiguration: async () => undefined,
      isSchemaSupported: async () => true,
      readHappierVersion: async () => '0.0.0-test',
    });
    const taskOperations = createPersonalHomeSystemTaskOperations({ operations: facade });

    const result = await createPersonalHomeInspectTaskKind({ operations: taskOperations }).run({
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      },
      emit: () => undefined,
      prompt: async () => undefined,
    });

    expect(result).toMatchObject({
      purpose: 'personal-home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      running: false,
      identity: { homeServerIdentityId: 'home_1', schemaVersion: '1' },
    });
  });

  it('routes restore through the installed migration process boundary before promotion', { timeout: 60_000 }, async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-task-installed-restore-'));
    try {
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
      await mkdir(defaults.configDir, { recursive: true });
      await writeFile(join(defaults.configDir, 'server.env'), [
        `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`,
        'HAPPIER_CANONICAL_SERVER_URL=http://127.0.0.1:43123',
        'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
        'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
        '',
      ].join('\n'));
      const layout = resolvePersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' });
      const migrationPaths = resolveInstalledPersonalHomeSqliteMigrationPaths({
        installRoot: layout.installRoot,
        platform: layout.platform,
      });
      const migrations = [
        { name: '20260830000000_base', sql: 'CREATE TABLE base_table (id TEXT);' },
        { name: '20260830000001_next', sql: 'CREATE TABLE next_table (id TEXT);' },
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
      await writeFile(layout.masterSecretPath, 'task-restore-master-secret');
      const database = new DatabaseSync(layout.databasePath);
      database.exec('CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      database.exec('CREATE TABLE "Account" (id TEXT PRIMARY KEY)');
      database.exec('CREATE TABLE "Session" (id TEXT PRIMARY KEY)');
      database.exec('CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT)');
      database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', 'task-restore-home');
      database.prepare('INSERT INTO "Account" (id) VALUES (?)').run('account-1');
      database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at, rolled_back_at) VALUES (?, ?, ?, NULL)').run(
        migrations[0].name,
        createHash('sha256').update(migrations[0].sql).digest('hex'),
        new Date().toISOString(),
      );
      database.close();

      const processCalls: Array<Readonly<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }>> = [];
      const owner = await createCanonicalPersonalHomeOperations({
        homeDir,
        platform: 'linux',
        mode: 'user',
        readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }),
        readHappierVersion: async () => '0.0.0-test',
        lifecycle: {
          isRunning: async () => false,
          stop: async () => undefined,
          start: async () => undefined,
          healthCheck: async () => true,
        },
        attestActivatedHome: async () => ({
          authenticated: true,
          homeServerIdentityId: 'task-restore-home',
          accountCount: 1,
          sessionCount: 0,
        }),
        runMigrationProcess: async (input) => {
          processCalls.push(input);
          const stagedDatabaseUrl = input.env.DATABASE_URL;
          if (!stagedDatabaseUrl) throw new Error('Missing staged database URL');
          const stagedDatabase = new DatabaseSync(new URL(stagedDatabaseUrl).pathname);
          stagedDatabase.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at, rolled_back_at) VALUES (?, ?, ?, NULL)').run(
            migrations[1].name,
            catalog[1]!.checksum,
            new Date().toISOString(),
          );
          stagedDatabase.close();
        },
      });
      const backup = await owner.backup();
      const taskOperations = createPersonalHomeSystemTaskOperations({ operations: owner });

      const result = await createPersonalHomeRestoreTaskKind({ operations: taskOperations }).run({
        params: {
          target: { kind: 'local' },
          channel: 'stable',
          mode: 'user',
          purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
          archivePath: backup.path,
          confirmOverwrite: true,
        },
        emit: () => undefined,
        prompt: async () => undefined,
      });

      expect(result).toMatchObject({ outcome: 'restored' });
      expect(processCalls).toHaveLength(1);
      expect(processCalls[0]).toMatchObject({
        command: migrationPaths.serverBinaryPath,
        args: ['--migrate-only'],
      });
      expect(processCalls[0]!.env.DATABASE_URL).not.toContain(layout.databasePath);
      expect(processCalls[0]!.env.HAPPIER_SERVER_LIGHT_DATA_DIR).not.toBe(layout.dataDir);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('rejects a caller purpose mismatch before the canonical owner performs backup work', async () => {
    const homeDir = join(tmpdir(), `happier-task-purpose-${Date.now()}`);
    let sqliteMaintenanceCalls = 0;
    const facade = createPersonalHomeOperations({
      readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }),
      readIdentity: async () => ({ homeServerIdentityId: 'home_1', schemaVersion: '1' }),
      resolveLayout: async () => resolvePersonalHomeRuntimeLayout({
        homeDir,
        platform: 'linux',
        mode: 'user',
      }),
      validateLayout: async () => undefined,
      lifecycle: {
        isRunning: async () => false,
        stop: async () => undefined,
        start: async () => undefined,
      },
      sqliteMaintenance: async () => {
        sqliteMaintenanceCalls += 1;
        return {
          checkpoint: async () => ({ busy: 0 }),
          quickCheck: async () => true,
          close: async () => undefined,
        };
      },
      readConfiguration: async () => ({}),
      prepareConfiguration: async () => ({ rollbackArtifact: '/tmp/config.rollback', apply: async () => undefined, rollback: async () => undefined }),
      recoverConfiguration: async () => undefined,
      isSchemaSupported: async () => true,
      readHappierVersion: async () => '0.0.0-test',
    });
    const taskOperations = createPersonalHomeSystemTaskOperations({ operations: facade });

    await expect(createPersonalHomeBackupTaskKind({ operations: taskOperations }).run({
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:49999' },
      },
      emit: () => undefined,
      prompt: async () => undefined,
    })).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
    expect(sqliteMaintenanceCalls).toBe(0);
  });

  it('binds the requested URL to the backup owner preflight without a separate inspect authorization', async () => {
    const homeDir = join(tmpdir(), `happier-task-purpose-switch-${Date.now()}`);
    let sqliteMaintenanceCalls = 0;
    const owner = createPersonalHomeOperations({
      readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:49999' }),
      readIdentity: async () => ({ homeServerIdentityId: 'home_1', schemaVersion: '1' }),
      resolveLayout: async () => resolvePersonalHomeRuntimeLayout({
        homeDir,
        platform: 'linux',
        mode: 'user',
      }),
      validateLayout: async () => undefined,
      lifecycle: { isRunning: async () => false, stop: async () => undefined, start: async () => undefined },
      sqliteMaintenance: async () => {
        sqliteMaintenanceCalls += 1;
        return { checkpoint: async () => ({ busy: 0 }), quickCheck: async () => true, close: async () => undefined };
      },
      readConfiguration: async () => ({}),
      prepareConfiguration: async () => ({ rollbackArtifact: '/tmp/config.rollback', apply: async () => undefined, rollback: async () => undefined }),
      recoverConfiguration: async () => undefined,
      readHappierVersion: async () => '0.0.0-test',
      isSchemaSupported: async () => true,
    });
    let inspectCalls = 0;
    const taskOperations = createPersonalHomeSystemTaskOperations({
      operations: {
        ...owner,
        inspect: async () => {
          inspectCalls += 1;
          return await owner.inspect();
        },
      },
    });

    await expect(taskOperations.backup({
      requestedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      runtimeTarget: { channel: 'stable', mode: 'user' },
      progress: () => undefined,
      confirm: async () => false,
    })).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
    expect(inspectCalls).toBe(0);
    expect(sqliteMaintenanceCalls).toBe(0);
  });

  it('preserves an allowlisted owner failure code through executeSystemTask', async () => {
    const homeDir = join(tmpdir(), `happier-task-domain-error-${Date.now()}`);
    const owner = createPersonalHomeOperations({
      readPurpose: async () => ({ kind: 'generic' }),
      readIdentity: async () => ({ homeServerIdentityId: 'home_1', schemaVersion: '1' }),
      resolveLayout: async () => resolvePersonalHomeRuntimeLayout({
        homeDir,
        platform: 'linux',
        mode: 'user',
      }),
      validateLayout: async () => undefined,
      lifecycle: { isRunning: async () => false, stop: async () => undefined, start: async () => undefined },
      sqliteMaintenance: async () => ({ checkpoint: async () => ({ busy: 0 }), quickCheck: async () => true, close: async () => undefined }),
      readConfiguration: async () => ({}),
      prepareConfiguration: async () => ({ rollbackArtifact: '/tmp/config.rollback', apply: async () => undefined, rollback: async () => undefined }),
      recoverConfiguration: async () => undefined,
      readHappierVersion: async () => '0.0.0-test',
      isSchemaSupported: async () => true,
    });
    const kind = createPersonalHomeBackupTaskKind({
      operations: createPersonalHomeSystemTaskOperations({ operations: owner }),
    });
    const result = await executeSystemTask({
      spec: {
        protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
        kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.backup,
        params: {
          target: { kind: 'local' },
          channel: 'stable',
          mode: 'user',
          purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        },
      },
      taskId: 'personal-home-domain-error',
      registry: createSystemTaskRegistry([{
        kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.backup,
        handler: createExecutionRunnerFromKind(kind),
      }]),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'purpose_not_personal_home' } });
  });

  it('keeps non-restore operations available while restore schema support is unavailable', async () => {
    const homeDir = join(tmpdir(), `happier-task-restore-unavailable-${Date.now()}`);
    let sqliteMaintenanceCalls = 0;
    const operations = createPersonalHomeOperations({
      readPurpose: async () => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }),
      readIdentity: async () => ({ homeServerIdentityId: 'home_1', schemaVersion: '1' }),
      resolveLayout: async () => resolvePersonalHomeRuntimeLayout({
        homeDir,
        platform: 'linux',
        mode: 'user',
      }),
      validateLayout: async () => undefined,
      lifecycle: {
        isRunning: async () => false,
        stop: async () => undefined,
        start: async () => undefined,
      },
      sqliteMaintenance: async () => {
        sqliteMaintenanceCalls += 1;
        return {
          checkpoint: async () => ({ busy: 0 }),
          quickCheck: async () => true,
          close: async () => undefined,
        };
      },
      readConfiguration: async () => ({}),
      prepareConfiguration: async () => ({ rollbackArtifact: '/tmp/config.rollback', apply: async () => undefined, rollback: async () => undefined }),
      recoverConfiguration: async () => undefined,
      isSchemaSupported: async () => false,
      readHappierVersion: async () => '0.0.0-test',
    });
    const taskOperations = createPersonalHomeSystemTaskOperations({
      operations,
      restoreAvailability: 'unavailable',
    });

    await expect(taskOperations.inspect({
      requestedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      runtimeTarget: { channel: 'stable', mode: 'user' },
      progress: () => undefined,
      confirm: async () => false,
    })).resolves.toMatchObject({ purpose: 'personal-home' });
    await expect(taskOperations.restore({
      archivePath: '/tmp/home.tar',
      confirmOverwrite: true,
      requestedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      runtimeTarget: { channel: 'stable', mode: 'user' },
      progress: () => undefined,
      confirm: async () => false,
    })).rejects.toMatchObject({ code: 'unsupported' });
    expect(sqliteMaintenanceCalls).toBe(0);
  });

  it('treats unsupported ssh.auth values as agent auth (no password prompt)', () => {
    expect(parseSystemTaskSshConfig({
      target: 'dev@example.test',
      auth: 'not_supported',
    })).toEqual({
      target: 'dev@example.test',
      auth: 'agent',
    });
  });

  it('parses password ssh auth with the password payload preserved', () => {
    expect(parseSystemTaskSshConfig({
      target: 'dev@example.test',
      auth: 'password',
      password: 'super-secret',
    })).toEqual({
      target: 'dev@example.test',
      auth: 'password',
      password: 'super-secret',
    });
  });

  it('returns the canonical relay runtime status payload', async () => {
    const kind = createRelayRuntimeStatusTaskKind({
      readStatus: async () => ({
        installed: true,
        version: '1.2.3',
        service: {
          active: true,
          enabled: true,
        },
        baseUrl: 'http://127.0.0.1:3005',
        purpose: {
          kind: 'personal-home',
          canonicalServerUrl: 'http://127.0.0.1:3005',
        },
        canonicalServerUrl: 'http://127.0.0.1:3005',
        dataPresent: true,
        anonymousSignupEnabled: false,
      }),
      checkHealth: async () => true,
    });

    const events: unknown[] = [];
    const result = await kind.run({
      params: {
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
      },
      emit: (event) => {
        events.push(event);
      },
      prompt: async () => {
        throw new Error('relay runtime status should not prompt');
      },
    });

    expect(events).toEqual([
      {
        type: 'progress',
        stepId: 'relay.status.inspect',
        message: 'Inspecting relay runtime',
      },
      {
        type: 'progress',
        stepId: 'relay.status.health',
        message: 'Checking relay runtime health',
      },
    ]);
    expect(result).toEqual({
      channel: 'stable',
      mode: 'user',
      installed: true,
      version: '1.2.3',
      service: {
        active: true,
        enabled: true,
      },
      relayUrl: 'http://127.0.0.1:3005',
      healthy: true,
      purpose: {
        kind: 'personal-home',
        canonicalServerUrl: 'http://127.0.0.1:3005',
      },
      canonicalServerUrl: 'http://127.0.0.1:3005',
      dataPresent: true,
      anonymousSignupEnabled: false,
    });
  });

  it('preserves relay runtime warnings in the canonical status payload', async () => {
    const kind = createRelayRuntimeStatusTaskKind({
      readStatus: async () => ({
        installed: true,
        version: '1.2.3',
        service: {
          active: true,
          enabled: true,
        },
        baseUrl: 'http://127.0.0.1:3005',
        warnings: ['Detected older preview relay state with a different data secret.'],
      }),
      checkHealth: async () => true,
    });

    const result = await kind.run({
      params: {
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
      },
      emit: () => undefined,
      prompt: async () => {
        throw new Error('relay runtime status should not prompt');
      },
    });

    expect(result).toEqual({
      channel: 'preview',
      mode: 'user',
      installed: true,
      version: '1.2.3',
      service: {
        active: true,
        enabled: true,
      },
      relayUrl: 'http://127.0.0.1:3005',
      healthy: true,
      warnings: ['Detected older preview relay state with a different data secret.'],
    });
  });

  it('installs or updates the relay runtime and returns the canonical task payload', async () => {
    const events: unknown[] = [];
    let receivedParams: unknown;
    const kind = createRelayRuntimeInstallOrUpdateTaskKind({
      installOrUpdate: async (params) => (receivedParams = params, {
        relayUrl: 'http://127.0.0.1:3005',
        mode: 'user',
      }),
    });

    const result = await kind.run({
      params: {
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:3005' },
        expectedPersonalHomeState: {
          installed: false,
          canonicalServerUrl: null,
          dataPresent: false,
        },
      },
      emit: (event) => {
        events.push(event);
      },
      prompt: async () => {
        throw new Error('installOrUpdate should not prompt');
      },
    });

    expect(events).toEqual([
      {
        type: 'progress',
        stepId: 'relay.install',
        message: 'Installing relay runtime',
      },
    ]);
    expect(result).toEqual({
      relayUrl: 'http://127.0.0.1:3005',
      mode: 'user',
    });
    expect(receivedParams).toMatchObject({
      expectedPersonalHomeState: {
        installed: false,
        canonicalServerUrl: null,
        dataPresent: false,
      },
    });
  });

  it('starts the relay runtime service and returns a fresh canonical status snapshot', async () => {
    const events: unknown[] = [];
    const kind = createRelayRuntimeStartTaskKind({
      control: async () => undefined,
      readStatus: async () => ({
        installed: true,
        version: '2.3.4',
        service: {
          active: true,
          enabled: true,
        },
        baseUrl: 'http://127.0.0.1:3005',
      }),
      checkHealth: async () => true,
    });

    const result = await kind.run({
      params: {
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
      },
      emit: (event) => {
        events.push(event);
      },
      prompt: async () => {
        throw new Error('start should not prompt');
      },
    });

    expect(events).toEqual([
      {
        type: 'progress',
        stepId: 'relay.start',
        message: 'Starting relay runtime',
      },
      {
        type: 'progress',
        stepId: 'relay.status.inspect',
        message: 'Inspecting relay runtime',
      },
      {
        type: 'progress',
        stepId: 'relay.status.health',
        message: 'Checking relay runtime health',
      },
    ]);
    expect(result).toEqual({
      channel: 'preview',
      mode: 'user',
      installed: true,
      version: '2.3.4',
      relayUrl: 'http://127.0.0.1:3005',
      healthy: true,
      service: {
        active: true,
        enabled: true,
      },
    });
  });

  it('stops the relay runtime service and returns the canonical stop payload', async () => {
    const events: unknown[] = [];
    const kind = createRelayRuntimeStopTaskKind({
      control: async () => undefined,
    });

    const result = await kind.run({
      params: {
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
      },
      emit: (event) => {
        events.push(event);
      },
      prompt: async () => {
        throw new Error('stop should not prompt');
      },
    });

    expect(events).toEqual([
      {
        type: 'progress',
        stepId: 'relay.stop',
        message: 'Stopping relay runtime',
      },
    ]);
    expect(result).toEqual({
      stopped: true,
    });
  });

  it('runs the safe runtime uninstall through the existing lifecycle controller without deleting Home data', async () => {
    const events: unknown[] = [];
    const controlCalls: Array<Readonly<{ action: string; mode: string }>> = [];
    const kind = createRelayRuntimeUninstallTaskKind({
      control: async (params) => {
        controlCalls.push({ action: params.action, mode: params.mode ?? 'user' });
      },
    });

    const result = await kind.run({
      params: {
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
      },
      emit: (event) => {
        events.push(event);
      },
      prompt: async () => {
        throw new Error('uninstall should not prompt');
      },
    });

    // The uninstall task is a wrapper over the safe engine owner, which preserves the
    // database, files, master secret, and backups; no deletion facts ride on the task.
    expect(controlCalls).toEqual([{ action: 'uninstall', mode: 'user' }]);
    expect(events).toEqual([
      {
        type: 'progress',
        stepId: 'relay.uninstall',
        message: 'Uninstalling relay runtime',
      },
    ]);
    expect(result).toEqual({
      uninstalled: true,
    });
  });
});
