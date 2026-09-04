import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createPersonalHomeOperations,
  PersonalHomeOperationsError,
  type PersonalHomeIdentityFacts,
  type PersonalHomeOperationsDeps,
  type PersonalHomeRelocateInput,
} from './operations.js';
import * as tar from 'tar';

import { createPersonalHomeBackup, PERSONAL_HOME_BACKUP_INVENTORY_MAX_MANIFEST_READS } from './backup.js';
import { createPersonalHomeArchive, PERSONAL_HOME_BACKUP_QUICK_INSPECTION_MAX_MANIFEST_BYTES, verifyPersonalHomeArchive } from './archive.js';
import { resolvePersonalHomeRuntimeLayout, type PersonalHomeRuntimeLayout } from './layout.js';
import { fingerprintMasterSecret, serializePersonalHomeManifest, type PersonalHomeBackupManifestV1 } from './manifest.js';
import { acquirePersonalHomeOperationLock } from './lock.js';
import type { ManagedRelayPurpose } from './personalHomeRuntimeSpec.js';

const sqliteOk = {
  checkpoint: async () => ({ busy: 0 }),
  quickCheck: async () => true,
  close: async () => undefined,
} as const;

async function fixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), `happier-home-ops-${name}-`));
  const layout = resolvePersonalHomeRuntimeLayout({ homeDir: root, platform: 'linux', mode: 'user' });
  await mkdir(layout.dataDir, { recursive: true });
  await mkdir(join(layout.publicFilesDir, 'nested'), { recursive: true });
  await mkdir(layout.privateFilesDir, { recursive: true });
  await writeFile(layout.databasePath, 'sqlite-fixture');
  await writeFile(layout.masterSecretPath, 'master-secret-fixture');
  await writeFile(join(layout.publicFilesDir, 'nested', 'readme.txt'), 'public');
  await writeFile(join(layout.privateFilesDir, 'secret.txt'), 'private');
  await writeFile(join(layout.dataDir, 'user-marker.txt'), 'home-data');
  return { root, layout };
}

function makeDeps(layout: PersonalHomeRuntimeLayout, overrides: Partial<PersonalHomeOperationsDeps> = {}) {
  const events: string[] = [];
  let running = false;
  const deps: PersonalHomeOperationsDeps = {
    readPurpose: async (): Promise<ManagedRelayPurpose> => ({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43110' }),
    readIdentity: async (): Promise<PersonalHomeIdentityFacts> => ({ homeServerIdentityId: 'home-identity', schemaVersion: '1' }),
    resolveLayout: async () => layout,
    validateLayout: async () => undefined,
    lifecycle: {
      isRunning: async () => running,
      stop: async () => { events.push('home:stop'); running = false; },
      start: async () => { events.push('home:start'); running = true; },
      healthCheck: async () => true,
      quarantine: async () => { events.push('home:quarantine'); running = false; },
      activate: async () => { events.push('home:activate'); running = true; },
      readServiceStatus: async () => ({ running, quarantined: !running }),
    },
    attestActivatedHome: async () => ({
      authenticated: true,
      homeServerIdentityId: 'home-identity',
      accountCount: 1,
      sessionCount: 0,
    }),
    sqliteMaintenance: async () => ({
      checkpoint: async () => { events.push('sqlite:checkpoint'); return { busy: 0 }; },
      quickCheck: async () => true,
      close: async () => { events.push('sqlite:close'); },
    }),
    migrateStagedDatabase: async () => undefined,
    readIdentityFromDatabase: async () => ({ homeServerIdentityId: 'home-identity', schemaVersion: '1' }),
    readDataCountsFromDatabase: async () => ({ accountCount: 1, sessionCount: 0 }),
    readConfiguration: async () => ({ canonicalServerUrl: 'http://127.0.0.1:43110' }),
    prepareConfiguration: async () => {
      const rollbackArtifact = join(layout.configDir, 'server.env.00000000-0000-4000-8000-000000000001.restore-rollback');
      await mkdir(layout.configDir, { recursive: true });
      await writeFile(rollbackArtifact, 'previous-configuration');
      return { rollbackArtifact, apply: async () => undefined, rollback: async () => undefined };
    },
    inspectConfigurationStorage: async () => ({ targetPath: join(layout.configDir, 'server.env'), incomingBytes: 0, rollbackBytes: 0 }),
    recoverConfiguration: async () => undefined,
    finalizeConfiguration: async (_layout, artifact) => { await rm(artifact, { force: true }); },
    readHappierVersion: async () => '0.0.0',
    isSchemaSupported: async (_layout, schemaVersion) => schemaVersion === '1',
    ...overrides,
  };
  return { deps, events, setRunning: (value: boolean) => { running = value; } };
}

/** Writes a minimal but fully valid Personal Home backup archive with controlled manifest/metadata times. */
async function writeInventoryFixtureArchive(params: Readonly<{ backupsDir: string; name: string; createdAt: string; mtimeMs: number }>): Promise<Readonly<{ path: string; createdAt: string; archiveBytes: number }>> {
  const outputPath = join(params.backupsDir, params.name);
  const staging = `${outputPath}.inventory-staging`;
  const files = new Map<string, string>([
    ['database/home.sqlite', `sqlite-${params.createdAt}`],
    ['secrets/handy-master-secret.txt', 'inventory-secret'],
    ['configuration/home.env.json', '{}'],
  ]);
  await mkdir(staging, { recursive: true });
  for (const [path, content] of files) {
    await mkdir(dirname(join(staging, path)), { recursive: true });
    await writeFile(join(staging, path), content);
  }
  const archive = await createPersonalHomeArchive({
    stagingDir: staging,
    outputPath,
    manifest: {
      format: 'happier-personal-home-backup',
      version: 1,
      createdAt: params.createdAt,
      happierVersion: '0.0.0',
      schemaVersion: '1',
      homeServerIdentityId: 'home-identity',
      masterSecretFingerprint: fingerprintMasterSecret('inventory-secret'),
      databaseProvider: 'sqlite',
      filesProvider: 'local',
      sourcePlatform: 'linux',
      sourceRuntimeMode: 'user',
      entries: [...files.entries()].map(([path, content]) => ({
        path,
        size: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
      })),
    },
  });
  await rm(staging, { recursive: true, force: true });
  await utimes(outputPath, new Date(params.mtimeMs), new Date(params.mtimeMs));
  return { path: archive.path, createdAt: params.createdAt, archiveBytes: archive.archiveBytes };
}

async function writeRestoreRecoveryJournal(
  layout: PersonalHomeRuntimeLayout,
  state: 'rollback_available' | 'finalization_available' | 'ambiguous',
): Promise<void> {
  const operationsDir = join(layout.dataDir, '.operations');
  await mkdir(operationsDir, { recursive: true });
  if (state === 'ambiguous') {
    await writeFile(join(operationsDir, 'restore-journal.json'), '{invalid-json');
    return;
  }
  const id = '00000000-0000-4000-8000-000000000001';
  const stage = `${layout.dataDir}.restore-stage-${process.pid}-${id}`;
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
    hadTarget: false,
    state: state === 'finalization_available' && index < 4 ? 'promoted' : 'untouched',
  }));
  await writeFile(join(operationsDir, 'restore-journal.json'), `${JSON.stringify({
    version: 2,
    phase: state === 'finalization_available' ? 'completed' : 'prepared',
    stage,
    wasRunning: false,
    ...(state === 'finalization_available'
      ? { configurationRollbackArtifact: join(layout.configDir, `server.env.${id}.restore-rollback`) }
      : {}),
    entries,
  })}\n`);
}

async function writeActivatingRestoreJournal(
  layout: PersonalHomeRuntimeLayout,
  manifest: PersonalHomeBackupManifestV1,
): Promise<Readonly<{ journalPath: string; stage: string; configurationRollbackArtifact: string; rollbackPath: string }>> {
  const operationsDir = join(layout.dataDir, '.operations');
  const id = '00000000-0000-4000-8000-000000000002';
  const stage = `${layout.dataDir}.restore-stage-${process.pid}-${id}`;
  const configurationRollbackArtifact = join(layout.configDir, `server.env.${id}.restore-rollback`);
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
  await mkdir(operationsDir, { recursive: true });
  await mkdir(stage, { recursive: true });
  await mkdir(layout.configDir, { recursive: true });
  await writeFile(join(stage, 'manifest.json'), serializePersonalHomeManifest(manifest));
  await writeFile(configurationRollbackArtifact, 'previous-configuration');
  await writeFile(entries[0]!.rollback, 'previous-database');
  const journalPath = join(operationsDir, 'restore-journal.json');
  await writeFile(journalPath, `${JSON.stringify({
    version: 2,
    phase: 'activating',
    stage,
    wasRunning: true,
    configurationRollbackArtifact,
    configurationRollbackState: 'pending',
    entries,
  })}\n`);
  return { journalPath, stage, configurationRollbackArtifact, rollbackPath: entries[0]!.rollback };
}

describe('PersonalHomeOperations facade', () => {
  const publishedDestinationDescriptor = {
    v: 1 as const,
    homeServerIdentityId: 'srv_home_identity',
    canonicalServerUrl: 'http://127.0.0.1:43110',
    revision: 3,
    endpoints: [{ kind: 'https' as const, url: 'http://127.0.0.1:43110' }],
  };
  const makeRelocateInput = (): PersonalHomeRelocateInput => {
    let destinationStatusReads = 0;
    const absentDestination = { operationId: 'system-task:relocation-1', status: 'absent' as const };
    let descriptorReads = 0;
    return ({
    operationId: 'system-task:relocation-1',
    sourceDescriptorRevision: 1,
    destinationMachineId: 'destination-machine',
    destination: {
      stage: async (input) => ({
        ...input,
        status: 'quarantined',
        homeServerIdentityId: input.expectedHomeServerIdentityId,
        canonicalServerUrl: 'http://127.0.0.1:43110',
        minimumOuterRevisionExclusive: 1,
        authenticated: true,
        accountCount: 1,
        sessionCount: 0,
      }),
      status: async (operationId) => destinationStatusReads++ === 0 ? absentDestination : ({
        operationId,
        status: 'quarantined',
        bundleSha256: 'a'.repeat(64),
        expectedHomeServerIdentityId: 'srv_home_identity',
        expectedCanonicalServerUrl: 'http://127.0.0.1:43110',
        sourceDescriptorRevision: 1,
        homeServerIdentityId: 'srv_home_identity',
        canonicalServerUrl: 'http://127.0.0.1:43110',
        minimumOuterRevisionExclusive: 1,
      }),
      commit: async ({ operationId }) => ({
        operationId,
        status: 'active',
        bundleSha256: 'a'.repeat(64),
        expectedHomeServerIdentityId: 'srv_home_identity',
        expectedCanonicalServerUrl: 'http://127.0.0.1:43110',
        sourceDescriptorRevision: 1,
        homeServerIdentityId: 'srv_home_identity',
        canonicalServerUrl: 'http://127.0.0.1:43110',
        minimumOuterRevisionExclusive: 1,
      }),
      abort: async (operationId) => ({
        operationId,
        status: 'aborted',
        bundleSha256: 'a'.repeat(64),
        expectedHomeServerIdentityId: 'srv_home_identity',
        expectedCanonicalServerUrl: 'http://127.0.0.1:43110',
        sourceDescriptorRevision: 1,
      }),
    },
    publishDestination: async () => publishedDestinationDescriptor,
    readPublishedDescriptor: async () => descriptorReads++ === 0
      ? {
          v: 1,
          homeServerIdentityId: 'srv_home_identity',
          canonicalServerUrl: 'http://127.0.0.1:43110',
          revision: 1,
          endpoints: [{ kind: 'https', url: 'http://127.0.0.1:43110' }],
        }
      : publishedDestinationDescriptor,
  });
  };
  it('dispatches backup through the low-level owner with one lock, lifecycle stop/start, and mandatory SQLite maintenance', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('backup');
    try {
      const { deps, events, setRunning } = makeDeps(layout);
      setRunning(true);
      const ops = createPersonalHomeOperations(deps);
      const result = await ops.backup();
      expect(result.manifest.homeServerIdentityId).toBe('home-identity');
      expect(result.manifest.databaseProvider).toBe('sqlite');
      expect(result.path.startsWith(layout.backupsDir)).toBe(true);
      const verified = await verifyPersonalHomeArchive(result.path);
      expect(verified.homeServerIdentityId).toBe('home-identity');
      // Lifecycle: stop before maintenance, restart after; one common lock acquired and released.
      expect(events[0]).toBe('home:stop');
      expect(events).toContain('sqlite:checkpoint');
      expect(events[events.length - 1]).toBe('home:start');
      await expect(stat(join(layout.dataDir, '.operations', 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
      // JSON-safe result with no secret bytes.
      expect(JSON.stringify(result)).not.toContain('master-secret-fixture');
      expect(result.manifest.masterSecretFingerprint).toBe(fingerprintMasterSecret('master-secret-fixture'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe production SQLite maintenance without copying the database and still restarts the Home', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('backup-unstable');
    try {
      const { deps, events, setRunning } = makeDeps(layout, {
        sqliteMaintenance: async () => ({ checkpoint: async () => ({ busy: 3 }), quickCheck: async () => true, close: async () => undefined }),
      });
      setRunning(true);
      const ops = createPersonalHomeOperations(deps);
      await expect(ops.backup()).rejects.toMatchObject({ code: 'sqlite_snapshot_unstable' });
      const backups = await readdir(layout.backupsDir).catch(() => [] as string[]);
      expect(backups.filter((name) => name.endsWith('.tar'))).toHaveLength(0);
      expect(events).toContain('home:start');
      // Fail closed: a composition without the SQLite maintenance boundary cannot be constructed.
      const broken = { ...deps, sqliteMaintenance: undefined } as unknown as PersonalHomeOperationsDeps;
      expect(() => createPersonalHomeOperations(broken)).toThrow(PersonalHomeOperationsError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not checkpoint or copy SQLite until the lifecycle owner proves the Home stopped', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('backup-stop-failed');
    try {
      const checkpoint = vi.fn(async () => ({ busy: 0 }));
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => true,
          stop: async () => undefined,
          start: async () => undefined,
          healthCheck: async () => true,
        },
        sqliteMaintenance: async () => ({ checkpoint, quickCheck: async () => true, close: async () => undefined }),
      });
      await expect(createPersonalHomeOperations(deps).backup()).rejects.toMatchObject({ code: 'home_stop_failed' });
      expect(checkpoint).not.toHaveBeenCalled();
      expect((await readdir(layout.backupsDir).catch(() => [] as string[])).filter((name) => name.endsWith('.tar'))).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks a completed backup for attention when the restarted Home is unhealthy', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('backup-unhealthy-restart');
    try {
      let running = true;
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; },
          start: async () => { running = true; },
          healthCheck: async () => false,
        },
      });
      const result = await createPersonalHomeOperations(deps).backup();
      expect(result.homeNeedsAttention).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('attempts to restart a previously running Home when stop throws after partially stopping it', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('backup-partial-stop');
    try {
      let running = true;
      const starts: string[] = [];
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; throw new Error('partial stop'); },
          start: async () => { starts.push('start'); running = true; },
          healthCheck: async () => true,
        },
      });
      await expect(createPersonalHomeOperations(deps).backup()).rejects.toThrow('partial stop');
      expect(starts).toEqual(['start']);
      expect(running).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports backup failure and an unverifiable restart as home restart failure', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('backup-failure-restart-failed');
    try {
      let running = true;
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; },
          start: async () => { throw new Error('service start failed'); },
          healthCheck: async () => true,
        },
        sqliteMaintenance: async () => ({
          checkpoint: async () => { throw new Error('backup checkpoint failed'); },
          quickCheck: async () => true,
          close: async () => undefined,
        }),
      });

      const error = await createPersonalHomeOperations(deps).backup().then(() => null, (failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'home_restart_failed',
        message: expect.stringMatching(/backup.*checkpoint failed.*restart.*service start failed/iu),
        cause: expect.objectContaining({ message: 'backup checkpoint failed' }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats baseline runtime configuration without Home data as an empty restore destination', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('baseline-config-empty');
    try {
      await rm(layout.databasePath, { force: true });
      await rm(layout.publicFilesDir, { recursive: true, force: true });
      await rm(layout.privateFilesDir, { recursive: true, force: true });
      await rm(layout.masterSecretPath, { force: true });
      await mkdir(layout.configDir, { recursive: true });
      await writeFile(join(layout.configDir, 'server.env'), 'AUTH_ANONYMOUS_SIGNUP_ENABLED=0\n');
      await expect(stat(join(layout.configDir, 'server.env'))).resolves.toBeTruthy();
      await expect(createPersonalHomeOperations(makeDeps(layout).deps).inspect()).resolves.toMatchObject({
        storage: { destinationEmpty: true },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('authenticates and automatically finalizes a successful restore while retaining its recovery archive', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-source');
    const destination = await fixture('restore-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      await writeFile(destination.layout.databasePath, 'destination-before-restore');
      const { deps, events, setRunning } = makeDeps(destination.layout, {
        // The activated Home can receive a legitimate write after its listener opens.
        // Post-activation counts must remain plausible, not equal the offline stage.
        attestActivatedHome: async () => ({
          authenticated: true,
          homeServerIdentityId: 'home-identity',
          accountCount: 2,
          sessionCount: 1,
        }),
      });
      setRunning(true);
      const ops = createPersonalHomeOperations(deps);
      await expect(ops.restore({ archivePath: backup.path })).rejects.toMatchObject({ code: 'destination_not_empty' });
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('destination-before-restore');
      const result = await ops.restore({ archivePath: backup.path, confirmOverwrite: true });
      expect(result.outcome).toBe('restored');
      expect(result.manifest.homeServerIdentityId).toBe('home-identity');
      expect(result.recoveryArchive?.path.startsWith(destination.layout.backupsDir)).toBe(true);
      await expect(verifyPersonalHomeArchive(result.recoveryArchive!.path)).resolves.toMatchObject({
        homeServerIdentityId: 'home-identity',
      });
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      expect(events).toContain('home:stop');
      expect(events).toContain('home:start');
      expect(events.filter((event) => event === 'home:stop')).toHaveLength(1);
      expect(events.filter((event) => event === 'home:start')).toHaveLength(1);
      await expect(ops.inspect()).resolves.toMatchObject({ restoreRecovery: { status: 'none' } });
      await expect(stat(join(destination.layout.dataDir, '.operations', 'restore-journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      for (const rollbackPath of result.rollbackPaths ?? []) {
        await expect(stat(rollbackPath)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('rolls back instead of finalizing when the activated server attests a different Home', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-auth-mismatch-source');
    const destination = await fixture('restore-auth-mismatch-destination');
    const finalizeConfiguration = vi.fn(async (_layout: PersonalHomeRuntimeLayout, artifact: string) => {
      await rm(artifact, { force: true });
    });
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      await writeFile(destination.layout.databasePath, 'destination-before-restore');
      const { deps, setRunning } = makeDeps(destination.layout, {
        attestActivatedHome: async () => ({
          authenticated: true,
          homeServerIdentityId: 'different-home',
          accountCount: 1,
          sessionCount: 0,
        }),
        finalizeConfiguration,
      });
      setRunning(true);

      const result = await createPersonalHomeOperations(deps).restore({
        archivePath: backup.path,
        confirmOverwrite: true,
      });

      expect(result.outcome).toBe('rolled_back');
      expect(result.error).toContain('authenticated readiness attestation failed');
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('destination-before-restore');
      expect(finalizeConfiguration).not.toHaveBeenCalled();
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('leaves every destination byte untouched when the required recovery archive cannot be created', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-recovery-backup-source');
    const destination = await fixture('restore-recovery-backup-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      await writeFile(destination.layout.databasePath, 'destination-before-restore');
      await writeFile(join(destination.layout.publicFilesDir, 'nested', 'readme.txt'), 'destination-public-before');
      await writeFile(join(destination.layout.privateFilesDir, 'secret.txt'), 'destination-private-before');
      await writeFile(destination.layout.masterSecretPath, 'destination-secret-before');
      const { deps, events, setRunning } = makeDeps(destination.layout, {
        sqliteMaintenance: async (databasePath) => databasePath === destination.layout.databasePath
          ? {
              checkpoint: async () => { throw new Error('recovery archive failed'); },
              quickCheck: async () => true,
              close: async () => undefined,
            }
          : sqliteOk,
      });
      setRunning(true);

      await expect(createPersonalHomeOperations(deps).restore({
        archivePath: backup.path,
        confirmOverwrite: true,
      })).rejects.toThrow('recovery archive failed');

      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('destination-before-restore');
      await expect(readFile(join(destination.layout.publicFilesDir, 'nested', 'readme.txt'), 'utf8')).resolves.toBe('destination-public-before');
      await expect(readFile(join(destination.layout.privateFilesDir, 'secret.txt'), 'utf8')).resolves.toBe('destination-private-before');
      await expect(readFile(destination.layout.masterSecretPath, 'utf8')).resolves.toBe('destination-secret-before');
      await expect(stat(join(destination.layout.dataDir, '.operations', 'restore-journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(events.filter((event) => event === 'home:stop')).toHaveLength(1);
      expect(events.filter((event) => event === 'home:start')).toHaveLength(1);
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('reports cancellation after the recovery archive and a failed restart as home restart failure', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-cancel-restart-source');
    const destination = await fixture('restore-cancel-restart-destination');
    const abort = new AbortController();
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      let running = true;
      const { deps } = makeDeps(destination.layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; },
          start: async () => { throw new Error('service restart refused'); },
          healthCheck: async () => true,
        },
        sqliteMaintenance: async (databasePath) => ({
          checkpoint: async () => {
            if (databasePath === destination.layout.databasePath) abort.abort();
            return { busy: 0 };
          },
          quickCheck: async () => true,
          close: async () => undefined,
        }),
      });

      const error = await createPersonalHomeOperations(deps).restore({
        archivePath: backup.path,
        confirmOverwrite: true,
        signal: abort.signal,
      }).then(() => null, (failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'home_restart_failed',
        message: expect.stringMatching(/cancelled.*restart.*service restart refused/iu),
        cause: expect.objectContaining({ code: 'operation_cancelled' }),
      });
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('rejects a staged restore that contains no initialized Home account before preserving the destination', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-zero-account-source');
    const destination = await fixture('restore-zero-account-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      await writeFile(destination.layout.databasePath, 'destination-before-restore');
      const { deps } = makeDeps(destination.layout, {
        readDataCountsFromDatabase: async (_layout, databasePath) => databasePath === destination.layout.databasePath
          ? { accountCount: 1, sessionCount: 0 }
          : { accountCount: 0, sessionCount: 0 },
      });

      await expect(createPersonalHomeOperations(deps).restore({
        archivePath: backup.path,
        confirmOverwrite: true,
      })).rejects.toThrow(/account count/u);
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('destination-before-restore');
      await expect(stat(join(destination.layout.dataDir, '.operations', 'restore-journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('rolls back when promoted account or session counts differ from the verified post-migration stage', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-count-mismatch-source');
    const destination = await fixture('restore-count-mismatch-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      await writeFile(destination.layout.databasePath, 'destination-before-restore');
      const countReads: string[] = [];
      const { deps, events } = makeDeps(destination.layout, {
        readDataCountsFromDatabase: async (_layout, databasePath) => {
          countReads.push(databasePath);
          if (databasePath !== destination.layout.databasePath) return { accountCount: 1, sessionCount: 2 };
          return { accountCount: 1, sessionCount: 3 };
        },
      });
      const result = await createPersonalHomeOperations(deps).restore({
        archivePath: backup.path,
        confirmOverwrite: true,
      });
      expect(countReads).toContain(destination.layout.databasePath);
      expect(result.outcome).toBe('rolled_back');
      expect(result.error).toMatch(/account\/session counts/u);
      expect(events).not.toContain('home:start');
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('destination-before-restore');
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('keeps the stored destination identity authoritative over a caller-provided restore identity', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-identity-source');
    const destination = await fixture('restore-identity-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      const { deps } = makeDeps(destination.layout, {
        readIdentity: async () => ({ homeServerIdentityId: 'destination-home-identity', schemaVersion: '1' }),
        readIdentityFromDatabase: async () => ({ homeServerIdentityId: 'home-identity', schemaVersion: '1' }),
      });

      await expect(createPersonalHomeOperations(deps).restore({
        archivePath: backup.path,
        confirmOverwrite: true,
        expectedHomeServerIdentityId: 'home-identity',
      })).rejects.toMatchObject({ code: 'identity_mismatch' });
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('rejects caller identity when a non-empty restore destination identity is unreadable', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-unreadable-identity-source');
    const destination = await fixture('restore-unreadable-identity-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      const { deps } = makeDeps(destination.layout, {
        readIdentity: async () => { throw new Error('destination identity is unreadable'); },
      });

      await expect(createPersonalHomeOperations(deps).restore({
        archivePath: backup.path,
        confirmOverwrite: true,
        expectedHomeServerIdentityId: 'home-identity',
      })).rejects.toMatchObject({ code: 'identity_unavailable' });
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('rolls back through the low-level owner when post-swap health fails', { timeout: 60_000 }, async () => {
    const source = await fixture('rollback-source');
    const destination = await fixture('rollback-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      await writeFile(destination.layout.databasePath, 'destination-before-restore');
      const { deps } = makeDeps(destination.layout, {
        lifecycle: {
          isRunning: async () => false,
          stop: async () => undefined,
          start: async () => undefined,
          healthCheck: async () => false,
        },
      });
      const result = await createPersonalHomeOperations(deps).restore({ archivePath: backup.path, confirmOverwrite: true });
      expect(result.outcome).toBe('rolled_back');
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('destination-before-restore');
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destination.root, { recursive: true, force: true });
    }
  });

  it('refuses erase before confirmation when the installed Home identity is unreadable', async () => {
    const { root, layout } = await fixture('erase-unreadable-identity');
    try {
      const confirm = vi.fn(async () => false);
      const { deps, events, setRunning } = makeDeps(layout, {
        readIdentity: async () => { throw new Error('identity database unavailable'); },
      });
      setRunning(true);

      await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.toMatchObject({
        code: 'identity_unavailable',
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(events).not.toContain('home:stop');
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses erase before stop when the confirmed Home identity becomes unreadable', async () => {
    const { root, layout } = await fixture('erase-identity-unreadable-after-confirmation');
    try {
      let identityReads = 0;
      const { deps, events, setRunning } = makeDeps(layout, {
        readIdentity: async () => {
          identityReads += 1;
          if (identityReads > 1) throw new Error('identity database became unavailable');
          return { homeServerIdentityId: 'home-identity', schemaVersion: '1' };
        },
      });
      setRunning(true);
      const confirm = vi.fn(async () => true);

      await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.toMatchObject({
        code: 'identity_unavailable',
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(events).not.toContain('home:stop');
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('confirms the exact running-Home erase preview, revalidates it, then stops and deletes', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('erase');
    try {
      const sibling = join(root, 'sibling.txt');
      await writeFile(sibling, 'preserve');
      const order: string[] = [];
      let running = true;
      const { deps, events } = makeDeps(layout, {
        validateLayout: async () => { order.push('layout:validated'); },
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { order.push('home:stop'); running = false; },
          start: async () => { order.push('home:start'); running = true; },
          healthCheck: async () => true,
        },
      });
      const ops = createPersonalHomeOperations(deps);
      const result = await ops.erase({
        confirm: async (facts) => {
          order.push('confirm');
          expect(facts.paths).toContain(layout.databasePath);
          expect(facts.paths).toContain(layout.publicFilesDir);
          expect(facts.estimatedBytes).toBeGreaterThan(0);
          await expect(stat(join(layout.dataDir, '.operations', 'lock'))).resolves.toBeTruthy();
          await expect(stat(layout.databasePath)).resolves.toBeTruthy();
          return true;
        },
        progress: (stepId) => order.push(`progress:${stepId}`),
      });
      expect(result.removedPaths).toContain(layout.databasePath);
      expect(result.remainingUnknownPaths).toContain(join(layout.dataDir, 'user-marker.txt'));
      expect(result.stoppedRunningHome).toBe(true);
      expect(order.indexOf('confirm')).toBeLessThan(order.indexOf('home:stop'));
      expect(order.indexOf('home:stop')).toBeLessThan(order.indexOf('progress:erasing'));
      expect(order).not.toContain('home:start');
      expect(events).toEqual([]);
      await expect(stat(layout.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(layout.dataDir, '.operations', 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(sibling, 'utf8')).resolves.toBe('preserve');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks erase before confirmation or stop while update recovery is uncommitted', async () => {
    const { root, layout } = await fixture('erase-update-recovery');
    const operationDir = join(layout.dataDir, '.operations');
    const recoveryPath = join(operationDir, 'runtime-update-recovery.v1.json');
    await mkdir(operationDir, { recursive: true });
    await writeFile(recoveryPath, JSON.stringify({
      version: 1,
      phase: 'prepared',
      priorRunning: true,
      previousServiceDefinitionExisted: true,
      runtimeBackup: {
        directoryName: '.relay-runtime-backup-owned',
        hasPayload: true,
        hasRestorableServerBinary: true,
        hasMigrations: true,
        previousEnvText: null,
        previousStateText: null,
      },
      restorePoint: {
        fileName: 'pre-upgrade-owned.tar',
        homeServerIdentityId: 'home-identity',
        schemaVersion: '1',
      },
    }));
    try {
      const { deps, events, setRunning } = makeDeps(layout);
      setRunning(true);
      const confirm = vi.fn(async () => true);

      await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.toMatchObject({
        code: 'operation_recovery_required',
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(events).not.toContain('home:stop');
      await expect(readFile(recoveryPath, 'utf8')).resolves.toContain('"phase":"prepared"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['rollback_available', 'ambiguous'] as const)(
    'refuses erase before lifecycle mutation while restore recovery is %s',
    { timeout: 60_000 },
    async (recoveryState) => {
      const { root, layout } = await fixture(`erase-restore-${recoveryState}`);
      try {
        await writeRestoreRecoveryJournal(layout, recoveryState);
        const confirm = vi.fn(async () => true);
        const isRunning = vi.fn(async () => true);
        const stop = vi.fn(async () => undefined);
        const start = vi.fn(async () => undefined);
        const { deps } = makeDeps(layout, {
          lifecycle: { isRunning, stop, start, healthCheck: async () => true },
        });

        await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.toMatchObject({
          code: 'restore_recovery_required',
        });

        expect(confirm).not.toHaveBeenCalled();
        expect(isRunning).toHaveBeenCalledTimes(2);
        expect(stop).toHaveBeenCalledTimes(1);
        expect(start).not.toHaveBeenCalled();
        await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
        await expect(readFile(layout.masterSecretPath, 'utf8')).resolves.toBe('master-secret-fixture');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ['decline', async () => false],
    ['prompt failure', async () => { throw new Error('prompt transport failed'); }],
  ])('leaves a running Home untouched and preserves bytes on erase %s', { timeout: 60_000 }, async (_label, confirm) => {
    const { root, layout } = await fixture('erase-declined');
    try {
      let running = true;
      const events: string[] = [];
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { events.push('home:stop'); running = false; },
          start: async () => { events.push('home:start'); running = true; },
          healthCheck: async () => true,
        },
      });
      await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.toBeTruthy();
      expect(events).toEqual([]);
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      await expect(readFile(layout.masterSecretPath, 'utf8')).resolves.toBe('master-secret-fixture');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['declined confirmation', async () => false, async () => { throw new Error('service start failed'); }],
    ['prompt failure', async () => { throw new Error('prompt transport failed'); }, async () => undefined],
  ])('does not invoke restart after %s because confirmation precedes the lifecycle boundary', { timeout: 60_000 }, async (_label, confirm, start) => {
    const { root, layout } = await fixture('erase-restart-failed');
    try {
      let running = true;
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; },
          start: async () => { await start(); running = true; },
          healthCheck: async () => false,
        },
      });

      await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.not.toMatchObject({ code: 'home_restart_failed' });
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      await expect(readFile(layout.masterSecretPath, 'utf8')).resolves.toBe('master-secret-fixture');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restarts a previously running Home when erase stop throws after stopping it', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('erase-partial-stop');
    try {
      let running = true;
      const events: string[] = [];
      const confirm = vi.fn(async () => true);
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { events.push('home:stop'); running = false; throw new Error('partial stop'); },
          start: async () => { events.push('home:start'); running = true; },
          healthCheck: async () => true,
        },
      });

      await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.toThrow('partial stop');
      expect(events).toEqual(['home:stop', 'home:start']);
      expect(running).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      await expect(readFile(layout.masterSecretPath, 'utf8')).resolves.toBe('master-secret-fixture');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reports a failed recovery restart when erase stop throws after partially stopping the Home', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('erase-partial-stop-restart-failed');
    try {
      let running = true;
      const confirm = vi.fn(async () => true);
      const { deps } = makeDeps(layout, {
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; throw new Error('partial stop'); },
          start: async () => { throw new Error('service start failed'); },
          healthCheck: async () => true,
        },
      });

      await expect(createPersonalHomeOperations(deps).erase({ confirm })).rejects.toMatchObject({
        code: 'home_restart_failed',
        message: expect.stringMatching(/erase was not performed.*partial stop.*restart.*needs attention/iu),
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('aborts without stopping or deleting when the canonical layout changes after confirmation', { timeout: 60_000 }, async () => {
    const first = await fixture('erase-layout-first');
    const second = await fixture('erase-layout-second');
    try {
      let current = first.layout;
      const { deps } = makeDeps(first.layout, { resolveLayout: async () => current });
      await expect(createPersonalHomeOperations(deps).erase({
        confirm: async (facts) => {
          expect(facts.paths).toContain(first.layout.databasePath);
          expect(facts.paths).not.toContain(second.layout.databasePath);
          current = second.layout;
          return true;
        },
      })).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      await expect(readFile(first.layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      await expect(readFile(second.layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      await expect(readFile(second.layout.masterSecretPath, 'utf8')).resolves.toBe('master-secret-fixture');
    } finally {
      await rm(first.root, { recursive: true, force: true });
      await rm(second.root, { recursive: true, force: true });
    }
  });

  it('routes backup and erase through the same data-operation lock and refuses while another operation owns it', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('lock');
    try {
      const { deps } = makeDeps(layout);
      const ops = createPersonalHomeOperations(deps);
      const release = await acquirePersonalHomeOperationLock(layout.dataDir, 'backup');
      try {
        await expect(ops.erase({ confirm: async () => true })).rejects.toMatchObject({ code: 'operation_in_progress' });
        await expect(ops.backup()).rejects.toMatchObject({ code: 'operation_in_progress' });
      } finally {
        await release();
      }
      await expect(stat(join(layout.dataDir, '.operations', 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('enforces the personal-home purpose before any operation touches the Home', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('purpose');
    try {
      const { deps, events } = makeDeps(layout, {
        readPurpose: async (): Promise<ManagedRelayPurpose> => ({ kind: 'generic' }),
      });
      const ops = createPersonalHomeOperations(deps);
      const relocateInput = makeRelocateInput();
      await expect(ops.inspect()).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      await expect(ops.backup()).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      await expect(ops.restore({ archivePath: join(root, 'missing.tar'), confirmOverwrite: true })).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      await expect(ops.verifyBackup({ archivePath: join(root, 'missing.tar') })).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      await expect(ops.erase({ confirm: async () => true })).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      await expect(ops.relocate(relocateInput)).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      expect(events).toEqual([]);
      await expect(stat(join(layout.dataDir, '.operations', 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('dispatches relocation through the opaque destination owner and leaves the source durably quarantined', { timeout: 60_000 }, async () => {
    const source = await fixture('relocate-source');
    try {
      const { deps, events, setRunning } = makeDeps(source.layout, {
        readIdentity: async () => ({ homeServerIdentityId: 'srv_home_identity', schemaVersion: '1' }),
      });
      setRunning(true);
      let quarantined = false;
      const input = makeRelocateInput();
      const stage = vi.fn(input.destination.stage);
      const commit = vi.fn(input.destination.commit);
      const publishDestination = vi.fn(async () => {
        events.push('publish');
        return publishedDestinationDescriptor;
      });
      const ops = createPersonalHomeOperations({
        ...deps,
        lifecycle: {
          ...deps.lifecycle,
          quarantine: async () => { events.push('home:quarantine'); quarantined = true; },
          activate: async () => { events.push('home:activate'); quarantined = false; },
          readServiceStatus: async () => ({ running: !quarantined, quarantined }),
        },
      });
      const result = await ops.relocate({
        ...input,
        destination: { ...input.destination, stage, commit },
        publishDestination,
      });
      expect(result).toMatchObject({
        operationId: 'system-task:relocation-1',
        status: 'committed',
        destinationMachineId: 'destination-machine',
      });
      expect(events).toEqual(['home:stop', 'sqlite:checkpoint', 'sqlite:close', 'home:quarantine', 'publish']);
      expect(events).not.toContain('home:start');
      expect(stage).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(publishDestination).toHaveBeenCalledWith(expect.objectContaining({ homeServerIdentityId: 'srv_home_identity' }));
      const marker = JSON.parse(await readFile(join(source.layout.dataDir, '.operations', 'relocation-source.json'), 'utf8')) as { phase: string };
      expect(marker.phase).toBe('committed');
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  });

  it('restores the source when relocation stop throws after actually stopping it', async () => {
    const source = await fixture('relocate-ambiguous-stop');
    try {
      const { deps } = makeDeps(source.layout, {
        readIdentity: async () => ({ homeServerIdentityId: 'srv_home_identity', schemaVersion: '1' }),
      });
      let running = true;
      let quarantined = false;
      const activate = vi.fn(async () => { running = true; quarantined = false; });
      const input = makeRelocateInput();
      const stage = vi.fn(input.destination.stage);
      const ops = createPersonalHomeOperations({
        ...deps,
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; throw new Error('service stop response lost'); },
          start: async () => { running = true; },
          quarantine: async () => { running = false; quarantined = true; },
          activate,
          readServiceStatus: async () => ({ running, quarantined }),
        },
      });

      await expect(ops.relocate({
        ...input,
        destination: { ...input.destination, stage },
      })).rejects.toThrow('service stop response lost');
      expect(activate).toHaveBeenCalledTimes(1);
      expect(running).toBe(true);
      expect(stage).not.toHaveBeenCalled();
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  });

  it('returns a reserved source to service across a process restart when the destination staged nothing', { timeout: 60_000 }, async () => {
    const source = await fixture('relocate-restart-return');
    try {
      const { deps } = makeDeps(source.layout, {
        readIdentity: async () => ({ homeServerIdentityId: 'srv_home_identity', schemaVersion: '1' }),
      });
      let running = true;
      let quarantined = false;
      const activate = vi.fn(async () => { running = true; quarantined = false; });
      const lifecycle = {
        isRunning: async () => running,
        stop: async () => { running = false; },
        start: async () => { running = true; },
        healthCheck: async () => true,
        quarantine: async () => { running = false; quarantined = true; },
        activate,
        readServiceStatus: async () => ({ running, quarantined }),
      };
      const reserving = makeRelocateInput();
      let destinationStatusReads = 0;
      await expect(createPersonalHomeOperations({ ...deps, lifecycle }).relocate({
        ...reserving,
        destination: {
          ...reserving.destination,
          stage: async () => { throw new Error('transport closed'); },
          status: async (operationId) => {
            if (destinationStatusReads++ === 0) return { operationId, status: 'absent' as const };
            throw new Error('destination unreachable');
          },
        },
      })).rejects.toThrow('transport closed');
      expect(running).toBe(false);

      // A new process owns no invocation-local memory of the pre-relocation state.
      const restarted = makeRelocateInput();
      const abort = vi.fn(restarted.destination.abort);
      await expect(createPersonalHomeOperations({ ...deps, lifecycle }).relocate({
        ...restarted,
        recoveryAction: 'return_to_source',
        destination: {
          ...restarted.destination,
          abort,
          status: async (operationId) => ({ operationId, status: 'absent' as const }),
        },
      })).resolves.toMatchObject({ status: 'returned' });

      expect(activate).toHaveBeenCalledTimes(1);
      expect(running).toBe(true);
      expect(abort).not.toHaveBeenCalled();
      const marker = JSON.parse(await readFile(join(source.layout.dataDir, '.operations', 'relocation-source.json'), 'utf8')) as { phase: string };
      expect(marker.phase).toBe('returned_to_source');
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  });

  it('releases a failed reservation without starting a Home that was already stopped', { timeout: 60_000 }, async () => {
    const source = await fixture('relocate-initially-stopped');
    try {
      const { deps } = makeDeps(source.layout, {
        readIdentity: async () => ({ homeServerIdentityId: 'srv_home_identity', schemaVersion: '1' }),
      });
      let running = false;
      let quarantined = false;
      const activate = vi.fn(async () => { running = true; quarantined = false; });
      const input = makeRelocateInput();
      const ops = createPersonalHomeOperations({
        ...deps,
        lifecycle: {
          isRunning: async () => running,
          stop: async () => { running = false; },
          start: async () => { running = true; },
          healthCheck: async () => true,
          quarantine: async () => { running = false; quarantined = true; },
          activate,
          readServiceStatus: async () => ({ running, quarantined }),
        },
      });

      await expect(ops.relocate({
        ...input,
        destination: {
          ...input.destination,
          stage: async () => { throw new Error('transport closed'); },
          status: async (operationId) => ({ operationId, status: 'absent' as const }),
        },
      })).rejects.toThrow('transport closed');

      expect(activate).not.toHaveBeenCalled();
      expect(running).toBe(false);
      const marker = JSON.parse(await readFile(join(source.layout.dataDir, '.operations', 'relocation-source.json'), 'utf8')) as { phase: string };
      expect(marker.phase).toBe('returned_to_source');
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  });

  it('verifies a backup through the archive owner and compares identity without leaking secrets', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('verify');
    try {
      const ops = createPersonalHomeOperations(makeDeps(layout).deps);
      const backup = await createPersonalHomeBackup({
        layout,
        outputPath: join(layout.backupsDir, 'home.tar'),
        stagingDir: join(root, 'staging'),
        homeServerIdentityId: 'home-identity',
        schemaVersion: '1',
        happierVersion: '0.0.0',
        configuration: {},
        sqlite: sqliteOk,
      });
      const matched = await ops.verifyBackup({ archivePath: backup.path });
      expect(matched.manifest.version).toBe(1);
      expect(matched.archiveBytes).toBe(backup.archiveBytes);
      expect(matched.identityMatchesCurrentHome).toBe('match');
      expect(JSON.stringify(matched)).not.toContain('master-secret-fixture');
      const other = await createPersonalHomeBackup({
        layout,
        outputPath: join(layout.backupsDir, 'other.tar'),
        stagingDir: join(root, 'staging-other'),
        homeServerIdentityId: 'other-home',
        schemaVersion: '1',
        happierVersion: '0.0.0',
        configuration: {},
        sqlite: sqliteOk,
      });
      expect((await ops.verifyBackup({ archivePath: other.path })).identityMatchesCurrentHome).toBe('mismatch');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('inspects purpose, identity, layout, storage, and only the master-secret fingerprint', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('inspect');
    try {
      const { deps } = makeDeps(layout);
      const inspection = await createPersonalHomeOperations(deps).inspect();
      expect(inspection.purpose).toBe('personal-home');
      expect(inspection.canonicalServerUrl).toBe('http://127.0.0.1:43110');
      expect(inspection.layout.dataDir).toBe(layout.dataDir);
      expect(inspection.identity).toEqual({ homeServerIdentityId: 'home-identity', schemaVersion: '1' });
      expect(inspection.masterSecret).toEqual({ present: true, fingerprint: fingerprintMasterSecret('master-secret-fixture') });
      expect(inspection.storage.databasePresent).toBe(true);
      expect(inspection.running).toBe(false);
      expect(inspection.storage.latestBackup).toBeNull();
      expect(JSON.stringify(inspection)).not.toContain('master-secret-fixture');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('automatically finalizes a completed restore journal on the next operations contact', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('restore-contact-completed');
    try {
      await writeRestoreRecoveryJournal(layout, 'finalization_available');
      const artifact = join(layout.configDir, 'server.env.00000000-0000-4000-8000-000000000001.restore-rollback');
      await mkdir(layout.configDir, { recursive: true });
      await writeFile(artifact, 'previous-configuration');

      await expect(createPersonalHomeOperations(makeDeps(layout).deps).reconcileRestore()).resolves.toMatchObject({
        outcome: 'finalized',
      });
      await expect(stat(join(layout.dataDir, '.operations', 'restore-journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(artifact)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces completed-journal finalization failure and blocks ordinary mutation', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('restore-contact-completed-failure');
    try {
      await writeRestoreRecoveryJournal(layout, 'finalization_available');
      const artifact = join(layout.configDir, 'server.env.00000000-0000-4000-8000-000000000001.restore-rollback');
      await mkdir(layout.configDir, { recursive: true });
      await writeFile(artifact, 'previous-configuration');
      const { deps } = makeDeps(layout, {
        finalizeConfiguration: async () => { throw new Error('configuration cleanup unavailable'); },
      });
      const ops = createPersonalHomeOperations(deps);

      await expect(ops.backup({ outputPath: join(layout.backupsDir, 'must-not-exist.tar') })).rejects.toMatchObject({
        code: 'restore_recovery_required',
        message: expect.stringContaining('configuration cleanup unavailable'),
      });
      await expect(stat(join(layout.backupsDir, 'must-not-exist.tar'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(layout.dataDir, '.operations', 'restore-journal.json'))).resolves.toBeTruthy();
      await expect(ops.inspect()).resolves.toMatchObject({
        restoreRecovery: { status: 'finalization_available', phase: 'completed' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('revalidates and finalizes a valid running activating candidate on the next operations contact', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('restore-contact-activating-valid');
    try {
      const backup = await createPersonalHomeBackup({
        layout,
        outputPath: join(layout.backupsDir, 'contact.tar'),
        stagingDir: join(root, 'backup-staging'),
        homeServerIdentityId: 'home-identity',
        schemaVersion: '1',
        happierVersion: '0.0.0',
        configuration: {},
        sqlite: sqliteOk,
      });
      const interrupted = await writeActivatingRestoreJournal(layout, backup.manifest);
      const { deps, setRunning } = makeDeps(layout);
      setRunning(true);

      await expect(createPersonalHomeOperations(deps).inspect()).resolves.toMatchObject({
        restoreRecovery: { status: 'none' },
      });
      await expect(stat(interrupted.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(interrupted.stage)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(interrupted.configurationRollbackArtifact)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(interrupted.rollbackPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops an invalid activating candidate, preserves recovery artifacts, and blocks ordinary mutation', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('restore-contact-activating-invalid');
    try {
      const backup = await createPersonalHomeBackup({
        layout,
        outputPath: join(layout.backupsDir, 'contact.tar'),
        stagingDir: join(root, 'backup-staging'),
        homeServerIdentityId: 'home-identity',
        schemaVersion: '1',
        happierVersion: '0.0.0',
        configuration: {},
        sqlite: sqliteOk,
      });
      const interrupted = await writeActivatingRestoreJournal(layout, backup.manifest);
      let running = true;
      const stop = vi.fn(async () => { running = false; });
      const { deps } = makeDeps(layout, {
        lifecycle: { isRunning: async () => running, stop, start: async () => { running = true; }, healthCheck: async () => true },
        attestActivatedHome: async () => ({ authenticated: true, homeServerIdentityId: 'home-identity', accountCount: 2, sessionCount: 0 }),
      });

      await expect(createPersonalHomeOperations(deps).backup({ outputPath: join(layout.backupsDir, 'must-not-exist.tar') })).rejects.toMatchObject({
        code: 'restore_recovery_required',
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(running).toBe(false);
      await expect(stat(interrupted.journalPath)).resolves.toBeTruthy();
      await expect(stat(interrupted.stage)).resolves.toBeTruthy();
      await expect(readFile(interrupted.configurationRollbackArtifact, 'utf8')).resolves.toBe('previous-configuration');
      await expect(readFile(interrupted.rollbackPath, 'utf8')).resolves.toBe('previous-database');
      await expect(stat(join(layout.backupsDir, 'must-not-exist.tar'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(createPersonalHomeOperations(deps).inspect()).resolves.toMatchObject({
        restoreRecovery: { status: 'rollback_available', phase: 'activating' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops before blocking an ambiguous journal without trusting journal-controlled paths', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('restore-contact-ambiguous');
    try {
      const outside = join(root, 'outside-sentinel');
      await writeFile(outside, 'preserve');
      await mkdir(join(layout.dataDir, '.operations'), { recursive: true });
      await writeFile(join(layout.dataDir, '.operations', 'restore-journal.json'), JSON.stringify({ phase: 'activating', target: outside }));
      let running = true;
      const stop = vi.fn(async () => { running = false; });
      const { deps } = makeDeps(layout, {
        lifecycle: { isRunning: async () => running, stop, start: async () => { running = true; }, healthCheck: async () => true },
      });

      await expect(createPersonalHomeOperations(deps).backup({ outputPath: join(layout.backupsDir, 'must-not-exist.tar') })).rejects.toMatchObject({
        code: 'restore_recovery_required',
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(running).toBe(false);
      await expect(readFile(outside, 'utf8')).resolves.toBe('preserve');
      await expect(stat(join(layout.dataDir, '.operations', 'restore-journal.json'))).resolves.toBeTruthy();
      await expect(createPersonalHomeOperations(deps).inspect()).resolves.toMatchObject({
        restoreRecovery: { status: 'ambiguous', affectedTargets: [] },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('inspects manifest metadata without treating arbitrary tar files as Personal Home backups', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('inspect-backup-metadata');
    try {
      const olderPath = join(layout.backupsDir, 'personal-home-valid.tar');
      const newestPath = join(layout.backupsDir, 'newest-placeholder.tar');
      const { deps } = makeDeps(layout);
      const created = await createPersonalHomeOperations(deps).backup({ outputPath: olderPath });
      await writeFile(newestPath, Buffer.alloc(4096));
      await utimes(newestPath, new Date('2026-02-02T03:04:05.006Z'), new Date('2026-02-02T03:04:05.006Z'));
      await mkdir(join(layout.backupsDir, 'directory.tar'));
      await symlink(newestPath, join(layout.backupsDir, 'alias.tar'));
      await writeFile(join(layout.backupsDir, 'ignored.txt'), 'not an archive');

      const inspection = await createPersonalHomeOperations(deps).inspect();
      expect(inspection.storage.backupsCount).toBe(1);
      expect(inspection.storage.backupsCountComplete).toBe(true);
      expect(inspection.storage.latestBackup).toEqual({
        path: olderPath,
        createdAt: created.manifest.createdAt,
        archiveBytes: created.archiveBytes,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bounds inspect backup inventory to an explicitly truncated truthful projection across many archives', { timeout: 120_000 }, async () => {
    const { root, layout } = await fixture('inspect-backup-inventory-bounded');
    try {
      const { deps } = makeDeps(layout);
      const budget = PERSONAL_HOME_BACKUP_INVENTORY_MAX_MANIFEST_READS;
      const total = budget + 2;
      const created: Array<Readonly<{ path: string; createdAt: string; archiveBytes: number }>> = [];
      for (let index = 0; index < total; index += 1) {
        const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index * 7)).toISOString();
        created.push(await writeInventoryFixtureArchive({
          backupsDir: layout.backupsDir,
          name: `personal-home-${String(index).padStart(3, '0')}.tar`,
          createdAt,
          mtimeMs: Date.parse(createdAt),
        }));
      }
      // Creation order equals directory-metadata order, so the two oldest archives fall outside
      // the newest-candidate window and a bounded inventory must stop reading manifests before
      // reaching them.
      const inspection = await createPersonalHomeOperations(deps).inspect();
      expect(inspection.storage.backupsCountComplete).toBe(false);
      expect(inspection.storage.backupsCount).toBe(budget);
      expect(inspection.storage.latestBackup).toBeNull();
      // Bounded inspection never deletes or rewrites user-created backups.
      await expect(stat(created[0]!.path)).resolves.toMatchObject({ size: created[0]!.archiveBytes });
      await expect(stat(created[1]!.path)).resolves.toMatchObject({ size: created[1]!.archiveBytes });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports the backup inventory as incomplete when a candidate archive exceeds the quick-manifest budget', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('inspect-backup-inventory-unconfirmable');
    try {
      const { deps } = makeDeps(layout);
      const confirmed = await createPersonalHomeOperations(deps).backup({ outputPath: join(layout.backupsDir, 'personal-home-confirmed.tar') });
      const header = Buffer.alloc(512);
      new tar.Header({ path: 'manifest.json', type: 'File', size: PERSONAL_HOME_BACKUP_QUICK_INSPECTION_MAX_MANIFEST_BYTES + 1, mode: 0o600 }).encode(header);
      await writeFile(join(layout.backupsDir, 'personal-home-oversized.tar'), Buffer.concat([header, Buffer.alloc(1024)]));

      const inspection = await createPersonalHomeOperations(deps).inspect();
      expect(inspection.storage.backupsCountComplete).toBe(false);
      expect(inspection.storage.backupsCount).toBe(1);
      expect(inspection.storage.latestBackup).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bounds directory traversal even when the backup directory contains only unrelated entries', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('inspect-backup-directory-bounded');
    try {
      await mkdir(layout.backupsDir, { recursive: true });
      for (let index = 0; index < 65; index += 1) {
        await writeFile(join(layout.backupsDir, `unrelated-${String(index).padStart(3, '0')}.txt`), 'not a backup');
      }

      const inspection = await createPersonalHomeOperations(makeDeps(layout).deps).inspect();
      expect(inspection.storage).toMatchObject({
        backupsCount: 0,
        backupsCountComplete: false,
        latestBackup: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('tolerates an uninitialized Home for inspection but refuses data operations without identity', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('uninitialized');
    try {
      const { deps } = makeDeps(layout, {
        readIdentity: async (): Promise<PersonalHomeIdentityFacts> => { throw new Error('identity database unavailable'); },
      });
      const ops = createPersonalHomeOperations(deps);
      await expect(ops.inspect()).resolves.toMatchObject({ identity: null });
      await expect(ops.backup()).rejects.toMatchObject({ code: 'identity_unavailable' });
      await expect(ops.relocate(makeRelocateInput())).rejects.toMatchObject({ code: 'identity_unavailable' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves one fresh canonical layout and runtime version snapshot for each operation', { timeout: 60_000 }, async () => {
    const first = await fixture('fresh-layout-first'); const second = await fixture('fresh-layout-second');
    try {
      let current = first.layout; let version = '1.0.0';
      const { deps } = makeDeps(first.layout, { resolveLayout: async () => current, readHappierVersion: async () => version });
      const ops = createPersonalHomeOperations(deps);
      const one = await ops.backup();
      current = second.layout; version = '2.0.0';
      const two = await ops.backup();
      expect(one.path.startsWith(first.layout.backupsDir)).toBe(true);
      expect(two.path.startsWith(second.layout.backupsDir)).toBe(true);
      expect(one.manifest.happierVersion).toBe('1.0.0');
      expect(two.manifest.happierVersion).toBe('2.0.0');
    } finally { await rm(first.root, { recursive: true, force: true }); await rm(second.root, { recursive: true, force: true }); }
  });

  it('aborts under the acquired old lease when purpose layout changes before mutation', async () => {
    const first = await fixture('lease-layout-first'); const second = await fixture('lease-layout-second');
    try {
      let reads = 0; const checkpoint = vi.fn(async () => ({ busy: 0 }));
      const { deps } = makeDeps(first.layout, { resolveLayout: async () => ++reads === 1 ? first.layout : second.layout, sqliteMaintenance: async () => ({ checkpoint, quickCheck: async () => true, close: async () => undefined }) });
      await expect(createPersonalHomeOperations(deps).backup()).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
      expect(checkpoint).not.toHaveBeenCalled();
      await expect(readdir(first.layout.backupsDir)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(second.layout.backupsDir)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(first.root, { recursive: true, force: true }); await rm(second.root, { recursive: true, force: true }); }
  });

  it.each(['purpose', 'layout', 'identity'] as const)(
    'revalidates the source %s under the source operation lease before moving bytes',
    { timeout: 60_000 },
    async (changedFact) => {
      const first = await fixture(`relocate-revalidate-${changedFact}-first`);
      const second = await fixture(`relocate-revalidate-${changedFact}-second`);
      try {
        let purposeReads = 0;
        let layoutReads = 0;
        let identityReads = 0;
        const input = makeRelocateInput();
        const stage = vi.fn(input.destination.stage);
        const publish = vi.fn(input.publishDestination);
        const { deps } = makeDeps(first.layout, {
          readPurpose: async (): Promise<ManagedRelayPurpose> => {
            purposeReads += 1;
            return changedFact === 'purpose' && purposeReads > 1
              ? { kind: 'generic' }
              : { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43110' };
          },
          resolveLayout: async () => {
            layoutReads += 1;
            return changedFact === 'layout' && layoutReads > 1 ? second.layout : first.layout;
          },
          readIdentity: async () => {
            identityReads += 1;
            return {
              homeServerIdentityId: changedFact === 'identity' && identityReads > 1 ? 'srv_changed_home' : 'srv_home_identity',
              schemaVersion: '1',
            };
          },
        });
        const ops = createPersonalHomeOperations(deps);

        await expect(ops.relocate({
          ...input,
          destination: { ...input.destination, stage },
          publishDestination: publish,
        })).rejects.toMatchObject({
          code: changedFact === 'identity' ? 'identity_unavailable' : 'purpose_not_personal_home',
        });
        expect(stage).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      } finally {
        await rm(first.root, { recursive: true, force: true });
        await rm(second.root, { recursive: true, force: true });
      }
    },
  );

});
