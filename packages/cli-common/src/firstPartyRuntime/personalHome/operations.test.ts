import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPersonalHomeOperations,
  PersonalHomeOperationsError,
  type PersonalHomeIdentityFacts,
  type PersonalHomeOperationsDeps,
  type PersonalHomeRelocateInput,
  type PersonalHomeRelocationCommit,
} from './operations.js';
import { createPersonalHomeBackup } from './backup.js';
import { verifyPersonalHomeArchive } from './archive.js';
import { resolvePersonalHomeRuntimeLayout, type PersonalHomeRuntimeLayout } from './layout.js';
import { fingerprintMasterSecret } from './manifest.js';
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
    },
    sqliteMaintenance: async () => ({
      checkpoint: async () => { events.push('sqlite:checkpoint'); return { busy: 0 }; },
      quickCheck: async () => true,
      close: async () => { events.push('sqlite:close'); },
    }),
    migrateStagedDatabase: async () => undefined,
    readIdentityFromDatabase: async () => ({ homeServerIdentityId: 'home-identity', schemaVersion: '1' }),
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

describe('PersonalHomeOperations facade', () => {
  const destinationDescriptor = {
    v: 1 as const,
    homeServerIdentityId: 'home-identity',
    canonicalServerUrl: 'https://destination.example.test',
    revision: 1,
    endpoints: [{ kind: 'https' as const, url: 'https://destination.example.test' }],
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

  it('requires an erase-safety backup output outside every canonical Home data root', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('erase-safety-backup');
    try {
      const ops = createPersonalHomeOperations(makeDeps(layout).deps);
      await expect(ops.backup({
        intent: 'erase-safety',
        outputPath: join(layout.backupsDir, 'will-be-erased.tar'),
      })).rejects.toMatchObject({ code: 'unsafe_data_root' });

      const externalPath = join(root, 'verified-before-erase.tar');
      await expect(ops.backup({ intent: 'erase-safety', outputPath: externalPath })).resolves.toMatchObject({
        path: externalPath,
      });
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

  it('dispatches restore through the low-level owner, rejects missing confirmation, and rebuilds search', { timeout: 60_000 }, async () => {
    const source = await fixture('restore-source');
    const destination = await fixture('restore-destination');
    try {
      const backup = await createPersonalHomeOperations(makeDeps(source.layout).deps).backup();
      await writeFile(destination.layout.databasePath, 'destination-before-restore');
      const { deps, events } = makeDeps(destination.layout);
      const ops = createPersonalHomeOperations(deps);
      await expect(ops.restore({ archivePath: backup.path })).rejects.toMatchObject({ code: 'destination_not_empty' });
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('destination-before-restore');
      const result = await ops.restore({ archivePath: backup.path, confirmOverwrite: true });
      expect(result.outcome).toBe('restored');
      expect(result.manifest.homeServerIdentityId).toBe('home-identity');
      await expect(readFile(destination.layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      expect(events).toContain('home:stop');
      expect(events).toContain('home:start');
      await expect(ops.inspect()).resolves.toMatchObject({ restoreRecovery: { status: 'finalization_available', phase: 'completed' } });
      const rollbackPaths = result.rollbackPaths ?? [];
      await expect(ops.finalizeRestore()).resolves.toMatchObject({ outcome: 'finalized' });
      for (const path of rollbackPaths) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(ops.inspect()).resolves.toMatchObject({ restoreRecovery: { status: 'none' } });
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

  it('confirms the exact stopped-Home erase targets under the operation lock before deleting', { timeout: 60_000 }, async () => {
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
      expect(order.indexOf('home:stop')).toBeLessThan(order.indexOf('confirm'));
      expect(order.indexOf('confirm')).toBeLessThan(order.indexOf('progress:erasing'));
      expect(order).not.toContain('home:start');
      expect(events).toEqual([]);
      await expect(stat(layout.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(layout.dataDir, '.operations', 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(sibling, 'utf8')).resolves.toBe('preserve');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['rollback_available', 'finalization_available', 'ambiguous'] as const)(
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
        expect(isRunning).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
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
  ])('restarts a previously running Home and preserves bytes on erase %s', { timeout: 60_000 }, async (_label, confirm) => {
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
      expect(events).toEqual(['home:stop', 'home:start']);
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('sqlite-fixture');
      await expect(readFile(layout.masterSecretPath, 'utf8')).resolves.toBe('master-secret-fixture');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('deletes only the captured locked layout when ambient path resolution changes after confirmation', { timeout: 60_000 }, async () => {
    const first = await fixture('erase-layout-first');
    const second = await fixture('erase-layout-second');
    try {
      let current = first.layout;
      const { deps } = makeDeps(first.layout, { resolveLayout: async () => current });
      await createPersonalHomeOperations(deps).erase({
        confirm: async (facts) => {
          expect(facts.paths).toContain(first.layout.databasePath);
          expect(facts.paths).not.toContain(second.layout.databasePath);
          current = second.layout;
          return true;
        },
      });
      await expect(stat(first.layout.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
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
      const relocateInput: PersonalHomeRelocateInput = {
        destinationDataDir: join(root, 'destination'),
        destinationDescriptor,
      };
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

  it('dispatches relocation through the low-level owner, publishes homeServerIdentityId (never homeId), and keeps the source stopped', { timeout: 60_000 }, async () => {
    const source = await fixture('relocate-source');
    const destinationRoot = await mkdtemp(join(tmpdir(), 'happier-home-ops-relocate-dest-'));
    try {
      const { deps, events, setRunning } = makeDeps(source.layout);
      setRunning(true);
      const onCommit = vi.fn(async (_input: PersonalHomeRelocationCommit) => { events.push('publish'); });
      const ops = createPersonalHomeOperations({
        ...deps,
        relocation: {
          transfer: {
            send: async ({ sourcePath, expectedSha256 }) => ({
              receivedPath: sourcePath,
              bytes: (await stat(sourcePath)).size,
              sha256: expectedSha256,
            }),
          },
          prepareDestination: async () => { events.push('prepare'); },
          restoreDestinationWithLease: async () => { events.push('restore'); },
          verifyDestination: async () => ({ homeServerIdentityId: 'home-identity' }),
          startDestination: async () => { events.push('start-destination'); return { healthy: true, homeServerIdentityId: 'home-identity' }; },
          stopDestination: async () => { events.push('stop-destination'); },
          quarantineDestination: async () => { events.push('quarantine-destination'); },
          commitSameHomeRelocation: onCommit,
        },
      });
      const result = await ops.relocate({
        destinationDataDir: join(destinationRoot, 'destination'),
        destinationDescriptor,
      });
      expect(result).toMatchObject({
        homeServerIdentityId: 'home-identity',
        destinationVerified: true,
        sourceStopped: true,
        followerAction: 'reconnect',
      });
      expect(events).toEqual([
        'prepare',
        'home:stop',
        'sqlite:checkpoint',
        'sqlite:close',
        'restore',
        'start-destination',
        'stop-destination',
        'quarantine-destination',
        'publish',
        'start-destination',
      ]);
      expect(events).not.toContain('home:start');
      expect(onCommit).toHaveBeenCalledTimes(1);
      const commitInput = onCommit.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(commitInput).sort()).toEqual(['homeServerIdentityId', 'newConnectionDescriptor']);
      expect(commitInput.homeServerIdentityId).toBe('home-identity');
      expect(commitInput).not.toHaveProperty('homeId');
      const marker = JSON.parse(await readFile(join(source.layout.dataDir, '.operations', 'relocation.json'), 'utf8')) as { phase: string };
      expect(marker.phase).toBe('committed');
    } finally {
      await rm(source.root, { recursive: true, force: true });
      await rm(destinationRoot, { recursive: true, force: true });
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

  it('inspects regular backup archive metadata without requiring archive verification', { timeout: 60_000 }, async () => {
    const { root, layout } = await fixture('inspect-backup-metadata');
    try {
      await mkdir(layout.backupsDir, { recursive: true });
      const olderPath = join(layout.backupsDir, 'older-placeholder.tar');
      const newestPath = join(layout.backupsDir, 'newest-placeholder.tar');
      await writeFile(olderPath, 'not a tar archive');
      await writeFile(newestPath, Buffer.alloc(4096));
      await utimes(olderPath, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
      await utimes(newestPath, new Date('2026-02-02T03:04:05.006Z'), new Date('2026-02-02T03:04:05.006Z'));
      await mkdir(join(layout.backupsDir, 'directory.tar'));
      await symlink(newestPath, join(layout.backupsDir, 'alias.tar'));
      await writeFile(join(layout.backupsDir, 'ignored.txt'), 'not an archive');

      const { deps } = makeDeps(layout);
      const inspection = await createPersonalHomeOperations(deps).inspect();
      expect(inspection.storage.backupsCount).toBe(2);
      expect(inspection.storage.latestBackup).toEqual({
        path: newestPath,
        createdAt: '2026-02-02T03:04:05.006Z',
        archiveBytes: 4096,
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
      await expect(ops.relocate({
        destinationDataDir: join(root, 'destination'),
        destinationDescriptor,
      })).rejects.toMatchObject({ code: 'identity_unavailable' });
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
    'revalidates the source %s after both relocation locks are held and before moving bytes',
    { timeout: 60_000 },
    async (changedFact) => {
      const first = await fixture(`relocate-revalidate-${changedFact}-first`);
      const second = await fixture(`relocate-revalidate-${changedFact}-second`);
      try {
        let purposeReads = 0;
        let layoutReads = 0;
        let identityReads = 0;
        const transfer = vi.fn(async () => ({ receivedPath: join(first.root, 'unused.tar'), bytes: 0, sha256: '' }));
        const prepareDestination = vi.fn(async () => undefined);
        const publish = vi.fn(async () => undefined);
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
              homeServerIdentityId: changedFact === 'identity' && identityReads > 1 ? 'changed-home' : 'home-identity',
              schemaVersion: '1',
            };
          },
        });
        const ops = createPersonalHomeOperations({
          ...deps,
          relocation: {
            transfer: { send: transfer },
            prepareDestination,
            restoreDestinationWithLease: async () => undefined,
            verifyDestination: async () => ({ homeServerIdentityId: 'home-identity' }),
            startDestination: async () => ({ healthy: true, homeServerIdentityId: 'home-identity' }),
            stopDestination: async () => undefined,
            quarantineDestination: async () => undefined,
            commitSameHomeRelocation: publish,
          },
        });

        await expect(ops.relocate({
          destinationDataDir: join(first.root, 'destination'),
          destinationDescriptor,
        })).rejects.toMatchObject({ code: 'purpose_not_personal_home' });
        expect(prepareDestination).not.toHaveBeenCalled();
        expect(transfer).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      } finally {
        await rm(first.root, { recursive: true, force: true });
        await rm(second.root, { recursive: true, force: true });
      }
    },
  );

});
