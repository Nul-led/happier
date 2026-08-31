import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { SYSTEM_TASK_PROTOCOL_VERSION } from '@happier-dev/protocol';

import { createPersonalHomeOperations } from '../../firstPartyRuntime/personalHome/operations.js';
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
  createPersonalHomeRelocateTaskKind,
  createPersonalHomeRestoreTaskKind,
  createPersonalHomeVerifyBackupTaskKind,
  createPersonalHomeSystemTaskOperations,
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

describe('relay runtime shared system task kinds', () => {
  it('routes rollback and finalization through the existing restore task kind and keeps exactly six ids', async () => {
    const recoverRestore = vi.fn(async () => ({ outcome: 'rolled_back', affectedTargets: ['/home/data'] }));
    const finalizeRestore = vi.fn(async () => ({ outcome: 'finalized', removedPaths: ['/home/data.rollback'] }));
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}),
      restore: async () => ({}), recoverRestore, finalizeRestore, erase: async () => ({}), relocate: async () => ({}),
    };
    const result = await createPersonalHomeRestoreTaskKind({ operations }).run({
      params: {
        target: { kind: 'local' },
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        action: 'recover',
      },
      emit: () => undefined,
      prompt: async () => ({}),
    });
    expect(result).toEqual({ outcome: 'rolled_back', affectedTargets: ['/home/data'] });
    expect(recoverRestore).toHaveBeenCalledOnce();

    const finalized = await createPersonalHomeRestoreTaskKind({ operations }).run({
      params: {
        target: { kind: 'local' },
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        action: 'finalize',
      },
      emit: () => undefined,
      prompt: async () => ({}),
    });
    expect(finalized).toEqual({ outcome: 'finalized', removedPaths: ['/home/data.rollback'] });
    expect(finalizeRestore).toHaveBeenCalledOnce();
    expect(PERSONAL_HOME_SYSTEM_TASK_KIND_IDS).toHaveLength(6);
  });
  it('derives all six Personal Home operations from their task kinds', async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => (calls.push(['inspect', undefined]), { operation: 'inspect' }),
      backup: async (input) => (calls.push(['backup', input]), { operation: 'backup' }),
      verifyBackup: async (input) => (calls.push(['verify_backup', input]), { operation: 'verify_backup' }),
      restore: async (input) => (calls.push(['restore', input]), { operation: 'restore' }),
      recoverRestore: async () => ({ operation: 'recover_restore' }),
      finalizeRestore: async () => ({ operation: 'finalize_restore' }),
      erase: async (input) => (calls.push(['erase', input]), { operation: 'erase' }),
      relocate: async (input) => (calls.push(['relocate', input]), { operation: 'relocate' }),
    };
    const base = {
      target: { kind: 'local' as const },
      purpose: { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' },
    };
    const cases = [
      [createPersonalHomeInspectTaskKind, base],
      [createPersonalHomeBackupTaskKind, { ...base, outputPath: '/tmp/home.tar' }],
      [createPersonalHomeVerifyBackupTaskKind, { ...base, archivePath: '/tmp/home.tar' }],
      [createPersonalHomeRestoreTaskKind, { ...base, archivePath: '/tmp/home.tar', confirmOverwrite: true, expectedHomeServerIdentityId: 'home_1' }],
      [createPersonalHomeEraseTaskKind, base],
      [createPersonalHomeRelocateTaskKind, {
        ...base,
        destination: {
          targetId: 'computer_2',
          descriptor: {
            v: 1,
            homeServerIdentityId: 'srv_home_1',
            canonicalServerUrl: 'https://home.example.test',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
          },
        },
      }],
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
      'inspect', 'backup', 'verify_backup', 'restore', 'erase', 'relocate',
    ]);
  });

  it.each([
    ['inspect', createPersonalHomeInspectTaskKind, { unexpected: true }],
    ['backup', createPersonalHomeBackupTaskKind, { operation: 'backup' }],
    ['verify backup', createPersonalHomeVerifyBackupTaskKind, {}],
    ['restore', createPersonalHomeRestoreTaskKind, { archivePath: '/tmp/home.tar', confirmOverwrite: false }],
    ['erase', createPersonalHomeEraseTaskKind, { confirmErase: false }],
    ['relocate', createPersonalHomeRelocateTaskKind, {}],
  ])('rejects invalid %s params before invoking the owner', async (_label, factory, extra) => {
    let calls = 0;
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => (calls += 1, {}),
      backup: async () => (calls += 1, {}),
      verifyBackup: async () => (calls += 1, {}),
      restore: async () => (calls += 1, {}),
      recoverRestore: async () => (calls += 1, {}),
      finalizeRestore: async () => (calls += 1, {}),
      erase: async () => (calls += 1, {}),
      relocate: async () => (calls += 1, {}),
    };

    await expect(factory({ operations }).run({
      params: {
        target: { kind: 'local' },
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
      inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}), restore: async () => ({}), recoverRestore: async () => ({}), finalizeRestore: async () => ({}), relocate: async () => ({}),
      erase: async (context) => {
        confirmed = await context.confirm!({ canonicalServerUrl: 'http://127.0.0.1:43123', homeServerIdentityId: 'home-1', paths: ['/data/home.sqlite'], estimatedBytes: 42 });
        if (!confirmed) throw Object.assign(new Error('declined'), { code: 'confirmation_required' });
        return {};
      },
    };
    await expect(createPersonalHomeEraseTaskKind({ operations }).run({
      params: { target: { kind: 'local' }, purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' } },
      emit: () => undefined,
      prompt: async () => answer,
    })).rejects.toBeTruthy();
    expect(confirmed).toBe(false);
  });

  it('emits the owner-resolved erase prompt and accepts only the narrow approval shape', async () => {
    const prompts: unknown[] = [];
    const operations: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({}), backup: async () => ({}), verifyBackup: async () => ({}), restore: async () => ({}), recoverRestore: async () => ({}), finalizeRestore: async () => ({}), relocate: async () => ({}),
      erase: async (context) => ({ confirmed: await context.confirm!({ canonicalServerUrl: 'http://127.0.0.1:43123', homeServerIdentityId: 'home-1', paths: ['/canonical/home.sqlite'], estimatedBytes: 73 }) }),
    };
    await expect(createPersonalHomeEraseTaskKind({ operations }).run({
      params: { target: { kind: 'local' }, purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' } },
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
        recoverRestore: async () => ({}),
        finalizeRestore: async () => ({}),
        erase: async () => ({}),
        relocate: async () => ({}),
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
      recoverRestore: async () => ({}),
      finalizeRestore: async () => ({}),
      erase: async () => ({}),
      relocate: async () => ({}),
    };

    await expect(createPersonalHomeRestoreTaskKind({ operations }).run({
      params: {
        target: { kind: 'local' },
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
    const owner: PersonalHomeSystemTaskOperations = {
      inspect: async () => ({ ready: true }),
      backup: async () => ({}),
      verifyBackup: async () => ({}),
      restore: async () => ({}),
      recoverRestore: async () => ({}),
      finalizeRestore: async () => ({}),
      erase: async () => ({}),
      relocate: async () => ({}),
    };
    const operations = createDeferredPersonalHomeSystemTaskOperations(async () => {
      loads += 1;
      if (loads === 1) throw new Error('runtime not installed');
      return owner;
    });
    const context = {
      requestedPurpose: { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' },
      progress: () => undefined,
      confirm: async () => true,
    };

    await expect(operations.inspect(context)).rejects.toThrow('runtime not installed');
    await expect(operations.inspect(context)).resolves.toEqual({ ready: true });
    await expect(operations.inspect(context)).resolves.toEqual({ ready: true });
    expect(loads).toBe(2);
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
        recoverRestore: async () => ({}),
        finalizeRestore: async () => ({}),
        erase: async () => ({}),
        relocate: async () => ({}),
      },
    });

    await expect(kind.run({
      params: {
        target: { kind: 'local' },
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
        'HAPPIER_PUBLIC_SERVER_URL=http://127.0.0.1:43123',
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
      database.exec('CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT)');
      database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', 'task-restore-home');
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
      progress: () => undefined,
      confirm: async () => false,
    })).resolves.toMatchObject({ purpose: 'personal-home' });
    await expect(taskOperations.restore({
      archivePath: '/tmp/home.tar',
      confirmOverwrite: true,
      requestedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
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
    const kind = createRelayRuntimeInstallOrUpdateTaskKind({
      installOrUpdate: async () => ({
        relayUrl: 'http://127.0.0.1:3005',
        mode: 'user',
      }),
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
