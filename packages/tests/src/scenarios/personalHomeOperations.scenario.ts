import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { uninstallRelayRuntimePayloadLocal } from '../../../cli-common/src/firstPartyRuntime/relayRuntimeInstall';
import { verifyPersonalHomeArchive } from '../../../cli-common/src/firstPartyRuntime/personalHome/archive';
import { resolvePersonalHomeRuntimeLayout } from '../../../cli-common/src/firstPartyRuntime/personalHome/layout';
import {
  createCanonicalPersonalHomeOperations,
  createCanonicalPersonalHomeRelocationDestinationOwner,
  readPersonalHomeDataCountsFromSqlite,
  readPersonalHomeIdentityFromSqlite,
} from '../../../cli-common/src/firstPartyRuntime/personalHome/productionAdapters';
import {
  resolveInstalledPersonalHomeSqliteMigrationPaths,
  type PersonalHomeMigrationProcessRunner,
} from '../../../cli-common/src/firstPartyRuntime/personalHome/stagedMigrationFrontier';
import { readSqliteMigrationCatalog } from '../../../cli-common/src/firstPartyRuntime/sqliteMigrationCatalog';
import type { InteractiveSystemTaskKind, InteractiveSystemTaskPromptRequest } from '../../../cli-common/src/systemTasks/interactiveTaskKinds';
import {
  createPersonalHomeBackupTaskKind,
  createPersonalHomeEraseTaskKind,
  createPersonalHomeRestoreTaskKind,
  createPersonalHomeSystemTaskOperations,
  createPersonalHomeVerifyBackupTaskKind,
  PERSONAL_HOME_SYSTEM_TASK_KINDS,
  type PersonalHomeTaskBaseParams,
} from '../../../cli-common/src/systemTasks/kinds/relayRuntimeKinds';
import { createRemoteSshManageHostTaskKind } from '../../../cli-common/src/systemTasks/kinds/remoteSshManageHostKind';
import { SystemTaskExecutionError } from '../../../cli-common/src/systemTasks/runSystemTask';
import type { HomeConnectionDescriptorV1, SystemTaskJsonValue } from '@happier-dev/protocol';

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const purpose = Object.freeze({ kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' });
const baseline = Object.freeze({ name: '202608300001_home', sql: 'CREATE TABLE home_baseline (id TEXT);\n' });
const next = Object.freeze({ name: '202608300002_home_next', sql: 'CREATE TABLE home_next (id TEXT);\n' });

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function value(databasePath: string, sql: string): string {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database.prepare(sql).get() as Readonly<{ value?: unknown }> | undefined;
    require(typeof row?.value === 'string', `SQLite query did not return a string: ${sql}`);
    return row.value;
  } finally {
    database.close();
  }
}

async function fixture(
  label: string,
  withData: boolean,
  data: Readonly<{ identity: string; transcript: string; secret: string }> = {
    identity: 'srv_personal_home_fixture', transcript: 'real transcript bytes', secret: 'fixed-master-secret-bytes',
  },
  withPendingMigration = false,
) {
  const root = await mkdtemp(join(tmpdir(), `happier-personal-home-${label}-`));
  const layout = resolvePersonalHomeRuntimeLayout({ homeDir: root, platform: 'linux', mode: 'user' });
  const migrationPaths = resolveInstalledPersonalHomeSqliteMigrationPaths({ installRoot: layout.installRoot, platform: layout.platform });
  for (const migration of withPendingMigration ? [baseline, next] : [baseline]) {
    const directory = join(migrationPaths.migrationsDir, migration.name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'migration.sql'), migration.sql);
  }
  const catalog = await readSqliteMigrationCatalog(migrationPaths.migrationsDir);
  await mkdir(layout.configDir, { recursive: true });
  await mkdir(layout.dataDir, { recursive: true });
  await writeFile(join(layout.configDir, 'server.env'), [
    `HAPPIER_CANONICAL_SERVER_URL=${purpose.canonicalServerUrl}`,
    'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
    'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    'HAPPIER_FEATURE_ENCRYPTION__PLAIN_ACCOUNT_SETTINGS_AT_REST=plain',
    'HAPPIER_FEATURE_ENCRYPTION__PLAIN_ACCOUNT_CREDENTIALS_AT_REST=plain',
    'HAPPIER_FEATURE_ENCRYPTION__PLAIN_ACCOUNT_ARTIFACTS_AT_REST=plain',
    'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
    '',
  ].join('\n'), { mode: 0o600 });

  if (withData) {
    await mkdir(dirname(layout.databasePath), { recursive: true });
    const database = new DatabaseSync(layout.databasePath);
    database.exec('PRAGMA journal_mode=WAL; CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT); CREATE TABLE Account (id TEXT PRIMARY KEY); CREATE TABLE Session (id TEXT PRIMARY KEY); CREATE TABLE SessionMessage (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at, rolled_back_at) VALUES (?, ?, CURRENT_TIMESTAMP, NULL)').run(baseline.name, catalog[0]!.checksum);
    database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', data.identity);
    database.prepare('INSERT INTO Account (id) VALUES (?)').run('account_fixture');
    database.prepare('INSERT INTO Session (id) VALUES (?)').run('session_fixture');
    database.prepare('INSERT INTO SessionMessage (id, value) VALUES (?, ?)').run('msg_fixture', data.transcript);
    database.close();
    await mkdir(join(layout.publicFilesDir, 'attachments'), { recursive: true });
    await mkdir(layout.privateFilesDir, { recursive: true });
    await writeFile(join(layout.publicFilesDir, 'attachments', 'public.txt'), 'public fixture bytes');
    await writeFile(join(layout.privateFilesDir, 'private.txt'), 'private fixture bytes');
    await writeFile(layout.masterSecretPath, data.secret, { mode: 0o600 });
    await mkdir(dirname(layout.irohEndpointKeyPath), { recursive: true });
    await writeFile(layout.irohEndpointKeyPath, 'excluded-iroh-key');
  }

  const lifecycle = { running: withData, quarantined: false, healthResults: [] as boolean[] };
  const runMigrationProcess: PersonalHomeMigrationProcessRunner | undefined = withPendingMigration ? async (input) => {
    require(input.env.DATABASE_URL, 'Migration runner did not receive the staged database URL');
    const database = new DatabaseSync(new URL(input.env.DATABASE_URL).pathname);
    database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at, rolled_back_at) VALUES (?, ?, CURRENT_TIMESTAMP, NULL)').run(next.name, catalog[1]!.checksum);
    database.close();
  } : undefined;
  const operations = await createCanonicalPersonalHomeOperations({
    homeDir: root,
    platform: 'linux',
    mode: 'user',
    lifecycle: {
      isRunning: async () => lifecycle.running,
      stop: async () => { lifecycle.running = false; },
      start: async () => { lifecycle.running = true; lifecycle.quarantined = false; },
      quarantine: async () => { lifecycle.running = false; lifecycle.quarantined = true; },
      activate: async () => { lifecycle.running = true; lifecycle.quarantined = false; },
      readServiceStatus: async () => ({ running: lifecycle.running, quarantined: lifecycle.quarantined }),
      healthCheck: async () => lifecycle.healthResults.shift() ?? true,
    },
    attestActivatedHome: async () => ({
      authenticated: true,
      homeServerIdentityId: (await readPersonalHomeIdentityFromSqlite(layout.databasePath, catalog)).homeServerIdentityId,
      ...await readPersonalHomeDataCountsFromSqlite(layout.databasePath),
    }),
    readHappierVersion: async () => '0.3-current-source',
    readPurpose: async () => purpose,
    ...(runMigrationProcess ? { runMigrationProcess } : {}),
  });
  return { root, layout, catalog, lifecycle, operations, runMigrationProcess, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function runKind(
  kindId: string,
  kinds: Readonly<Record<string, InteractiveSystemTaskKind<SystemTaskJsonValue>>>,
  params: SystemTaskJsonValue,
  prompt: (request: InteractiveSystemTaskPromptRequest) => Promise<unknown> = async () => undefined,
) {
  const kind = kinds[kindId];
  require(kind, `Shared Personal Home task kind is absent: ${kindId}`);
  return kind.run({ params, emit: () => undefined, prompt });
}

function base(): PersonalHomeTaskBaseParams {
  return {
    target: { kind: 'local' },
    channel: 'stable',
    mode: 'user',
    purpose,
  };
}

function outcome(result: SystemTaskJsonValue): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const field = (result as Readonly<Record<string, SystemTaskJsonValue>>).outcome;
  return typeof field === 'string' ? field : undefined;
}

export async function assertPersonalHomeUninstallPreservesDataContract(): Promise<void> {
  const home = await fixture('uninstall', true);
  try {
    const statePath = join(home.layout.installRoot, 'self-host-state.json');
    const shimPath = join(home.root, 'shim', 'happier-server');
    await mkdir(join(home.layout.installRoot, 'ui-web'), { recursive: true });
    await mkdir(home.layout.logsDir, { recursive: true });
    await mkdir(dirname(shimPath), { recursive: true });
    await writeFile(join(home.layout.installRoot, 'bin', 'happier-server'), 'runtime payload');
    await writeFile(join(home.layout.installRoot, 'ui-web', 'index.html'), 'runtime ui');
    await writeFile(join(home.layout.logsDir, 'server.log'), 'runtime log');
    await writeFile(statePath, '{}');
    await writeFile(shimPath, 'shim');
    await uninstallRelayRuntimePayloadLocal({ installRoot: home.layout.installRoot, shimPath, statePath, logDir: home.layout.logsDir });
    require(!(await exists(join(home.layout.installRoot, 'bin'))), 'Uninstall retained runtime payload');
    require(!(await exists(resolveInstalledPersonalHomeSqliteMigrationPaths({
      installRoot: home.layout.installRoot,
      platform: home.layout.platform,
    }).migrationsDir)), 'Uninstall retained the installed migration catalog needed to reproduce safe-uninstall erase');
    require(await exists(home.layout.databasePath), 'Uninstall removed the Home database');
    require(await readFile(home.layout.masterSecretPath, 'utf8') === 'fixed-master-secret-bytes', 'Uninstall changed the master secret');
    require(value(home.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'") === 'real transcript bytes', 'Uninstall changed transcript bytes');
    require(await exists(join(home.layout.configDir, 'server.env')), 'Uninstall removed fixed configuration');

    const operations = createPersonalHomeSystemTaskOperations({ operations: home.operations });
    const erase = createPersonalHomeEraseTaskKind({ operations });
    const prompts: InteractiveSystemTaskPromptRequest[] = [];
    let rejected: unknown;
    try {
      await runKind(
        PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
        { [PERSONAL_HOME_SYSTEM_TASK_KINDS.erase]: erase },
        base(),
        async (request) => { prompts.push(request); return { confirmed: false }; },
      );
    } catch (error) { rejected = error; }
    require(rejected instanceof SystemTaskExecutionError && rejected.code === 'confirmation_required', 'Erase accepted a declined owner prompt');
    require(await exists(home.layout.databasePath) && await exists(home.layout.masterSecretPath), 'Declined erase changed Home bytes');
    require(home.lifecycle.running, 'Declined erase did not restart the previously running Home');
    require(prompts.length === 1 && prompts[0]?.kind === 'personal_home.confirm_erase.v1', 'Erase did not emit its interactive owner prompt');
    const promptData = prompts[0]?.data as Readonly<Record<string, SystemTaskJsonValue>>;
    require(Array.isArray(promptData.paths) && promptData.paths.includes(home.layout.databasePath), 'Erase prompt omitted the exact canonical database path');
    require(typeof promptData.estimatedBytes === 'number' && promptData.estimatedBytes > 0, 'Erase prompt omitted estimated bytes');
    await runKind(
      PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
      { [PERSONAL_HOME_SYSTEM_TASK_KINDS.erase]: erase },
      base(),
      async () => ({ confirmed: true }),
    );
    require(!(await exists(home.layout.databasePath)) && !(await exists(home.layout.masterSecretPath)), 'Confirmed erase retained Home data');
  } finally { await home.cleanup(); }
}

export async function assertPersonalHomeBackupRestoreContract(): Promise<void> {
  const source = await fixture('backup-source', true);
  const empty = await fixture('restore-empty', false, undefined, true);
  const rollback = await fixture('restore-rollback', true, { identity: 'srv_personal_home_fixture', transcript: 'prior transcript', secret: 'prior secret' }, true);
  try {
    const archivePath = join(source.root, 'home.tar');
    const sourceOperations = createPersonalHomeSystemTaskOperations({ operations: source.operations });
    const kinds = {
      [PERSONAL_HOME_SYSTEM_TASK_KINDS.backup]: createPersonalHomeBackupTaskKind({ operations: sourceOperations }),
      [PERSONAL_HOME_SYSTEM_TASK_KINDS.verifyBackup]: createPersonalHomeVerifyBackupTaskKind({ operations: sourceOperations }),
    };
    await runKind(PERSONAL_HOME_SYSTEM_TASK_KINDS.backup, kinds, { ...base(), outputPath: archivePath });
    await runKind(PERSONAL_HOME_SYSTEM_TASK_KINDS.verifyBackup, kinds, { ...base(), archivePath });
    const manifest = await verifyPersonalHomeArchive(archivePath);
    const entries = manifest.entries.map((entry) => entry.path);
    for (const path of ['database/home.sqlite', 'files/public/attachments/public.txt', 'files/private/private.txt', 'secrets/handy-master-secret.txt', 'configuration/home.env.json']) require(entries.includes(path), `Archive omitted ${path}`);
    require(!entries.some((path) => /runtime|iroh|account.*credential/iu.test(path)), 'Archive included excluded runtime credentials');
    if (process.platform !== 'win32') require(((await stat(archivePath)).mode & 0o077) === 0, 'Archive permissions are not restrictive');

    const emptyOperations = createPersonalHomeSystemTaskOperations({ operations: empty.operations });
    await runKind(PERSONAL_HOME_SYSTEM_TASK_KINDS.restore, { [PERSONAL_HOME_SYSTEM_TASK_KINDS.restore]: createPersonalHomeRestoreTaskKind({ operations: emptyOperations }) }, { ...base(), archivePath, confirmOverwrite: true, expectedHomeServerIdentityId: 'srv_personal_home_fixture' });
    require((await readPersonalHomeIdentityFromSqlite(empty.layout.databasePath, empty.catalog)).homeServerIdentityId === 'srv_personal_home_fixture', 'Restore changed identity');
    require(value(empty.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'") === 'real transcript bytes', 'Restore changed transcript bytes');
    require(await readFile(empty.layout.masterSecretPath, 'utf8') === 'fixed-master-secret-bytes', 'Restore changed master secret');
    require(await readFile(join(empty.layout.publicFilesDir, 'attachments', 'public.txt'), 'utf8') === 'public fixture bytes', 'Restore changed public file');
    require(await readFile(join(empty.layout.privateFilesDir, 'private.txt'), 'utf8') === 'private fixture bytes', 'Restore changed private file');

    const priorSecret = await readFile(rollback.layout.masterSecretPath, 'utf8');
    const priorTranscript = value(rollback.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'");
    rollback.lifecycle.healthResults.push(false, true);
    const rollbackOperations = createPersonalHomeSystemTaskOperations({ operations: rollback.operations });
    const result = await runKind(PERSONAL_HOME_SYSTEM_TASK_KINDS.restore, { [PERSONAL_HOME_SYSTEM_TASK_KINDS.restore]: createPersonalHomeRestoreTaskKind({ operations: rollbackOperations }) }, { ...base(), archivePath, confirmOverwrite: true, expectedHomeServerIdentityId: 'srv_personal_home_fixture' });
    require(outcome(result) === 'rolled_back', 'Activation failure did not roll back');
    require(await readFile(rollback.layout.masterSecretPath, 'utf8') === priorSecret, 'Failed restore mixed destination secret');
    require(value(rollback.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'") === priorTranscript, 'Failed restore mixed destination database');
  } finally { await Promise.all([source.cleanup(), empty.cleanup(), rollback.cleanup()]); }
}

export async function assertPersonalHomeRelocationContract(): Promise<void> {
  const source = await fixture('relocation-source', true);
  const destination = await fixture('relocation-destination', false, undefined, true);
  try {
    require(destination.runMigrationProcess, 'Destination lacks migration process');
    const destinationOwner = await createCanonicalPersonalHomeRelocationDestinationOwner({
      homeDir: destination.root,
      platform: 'linux',
      mode: 'user',
      quarantine: async () => { destination.lifecycle.running = false; destination.lifecycle.quarantined = true; },
      activate: async () => { destination.lifecycle.running = true; destination.lifecycle.quarantined = false; },
      readServiceStatus: async () => ({ running: destination.lifecycle.running, quarantined: destination.lifecycle.quarantined }),
      runMigrationProcess: destination.runMigrationProcess,
      attestStagedHome: async () => ({
        authenticated: true,
        homeServerIdentityId: (await readPersonalHomeIdentityFromSqlite(destination.layout.databasePath, destination.catalog)).homeServerIdentityId,
        ...await readPersonalHomeDataCountsFromSqlite(destination.layout.databasePath),
      }),
      attestActivatedHome: async () => ({
        authenticated: true,
        homeServerIdentityId: (await readPersonalHomeIdentityFromSqlite(destination.layout.databasePath, destination.catalog)).homeServerIdentityId,
        ...await readPersonalHomeDataCountsFromSqlite(destination.layout.databasePath),
      }),
      materializeEndpoint: async () => ({
        connectionDescriptor: {
          v: 1, homeServerIdentityId: 'srv_personal_home_fixture', canonicalServerUrl: 'https://destination.example.test',
          revision: 27, endpoints: [{ kind: 'https', url: 'https://destination.example.test' }],
        },
      }),
    });
    let transferredBytes = 0;
    let transferCount = 0;
    const transportedDestination = {
      ...destinationOwner,
      stage: async (input: Parameters<typeof destinationOwner.stage>[0]) => {
        transferCount += 1;
        const receivedPath = join(destination.root, 'received', `${input.operationId}.tar`);
        await mkdir(dirname(receivedPath), { recursive: true });
        await copyFile(input.archivePath, receivedPath);
        const bytes = await readFile(receivedPath);
        transferredBytes = bytes.byteLength;
        require(createHash('sha256').update(bytes).digest('hex') === input.bundleSha256, 'Transfer changed archive bytes');
        return destinationOwner.stage({ ...input, archivePath: receivedPath });
      },
    };
    const sourceDescriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_personal_home_fixture',
      canonicalServerUrl: purpose.canonicalServerUrl,
      revision: 7,
      endpoints: [{ kind: 'https' as const, url: purpose.canonicalServerUrl }],
    };
    let publishedDescriptor: HomeConnectionDescriptorV1 = sourceDescriptor;
    let publishAvailable = false;
    const relocationKind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => undefined,
      installRemoteCli: async () => undefined,
      runDaemonServiceCommand: async () => undefined,
      runRelayRuntimeCommand: async () => undefined,
      runPersonalHomeRelocation: async (input) => {
        const result = await source.operations.relocate({
          operationId: input.operationId,
          sourceDescriptorRevision: input.sourceDescriptorRevision,
          destinationMachineId: input.destinationMachineId,
          ...(input.recoveryAction ? { recoveryAction: input.recoveryAction } : {}),
          destination: transportedDestination,
          publishDestination: async (facts) => {
            require(source.lifecycle.quarantined && !source.lifecycle.running, 'Source was not quarantined before publication');
            require(destination.lifecycle.quarantined && !destination.lifecycle.running, 'Destination was not quarantined before publication');
            if (!publishAvailable) throw new Error('publication unavailable');
            publishedDescriptor = facts.connectionDescriptor;
            return input.publishDestination(facts);
          },
          readPublishedDescriptor: input.readPublishedDescriptor,
        });
        return { ...result };
      },
    });
    const relocate = () => runKind(
      'remote.ssh.manageHost.v1',
      { 'remote.ssh.manageHost.v1': relocationKind },
      {
        action: 'personalHome.relocate',
        channel: 'stable',
        relayRuntime: { channel: 'stable', mode: 'user' },
        personalHomeRelocation: {
          operationId: 'operation-fixture',
          destinationMachineId: 'machine-destination',
          sourceDescriptorRevision: sourceDescriptor.revision,
        },
        ssh: { target: 'destination.example.test', auth: 'agent' },
      },
      async (request) => {
        if (request.kind === 'personal_home.publish_relocation_descriptor.v1') {
          return { descriptor: publishedDescriptor };
        }
        if (request.kind === 'personal_home.read_relocation_descriptor.v1') {
          return { descriptor: publishedDescriptor };
        }
        throw new Error(`Unexpected relocation prompt: ${request.kind}`);
      },
    );

    const pending = await relocate();
    const pendingHome = (pending as Readonly<{ personalHome?: Readonly<{ status?: string; recoveryAction?: string }> }>).personalHome;
    require(pendingHome?.status === 'pending' && pendingHome.recoveryAction === 'finish_move', 'Publication failure did not preserve a finishable move');
    require(transferredBytes > 0, 'Relocation did not transfer real archive bytes');
    require(transferCount === 1, 'Initial relocation did not stage exactly one transferred bundle');
    require(!source.lifecycle.running && source.lifecycle.quarantined, 'Pending relocation did not retain the source disabled');
    require(!destination.lifecycle.running && destination.lifecycle.quarantined, 'Pending relocation activated the destination before publication');
    require(value(source.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'") === 'real transcript bytes', 'Relocation damaged source bytes');
    require(value(destination.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'") === 'real transcript bytes', 'Relocation did not move destination bytes');
    publishAvailable = true;
    const committed = await relocate();
    const committedHome = (committed as Readonly<{
      personalHome?: Readonly<{ status?: string; publishedDescriptor?: HomeConnectionDescriptorV1 }>;
    }>).personalHome;
    require(committedHome?.status === 'committed', 'Retry did not finish the already-staged relocation');
    require(
      JSON.stringify(committedHome.publishedDescriptor) === JSON.stringify(publishedDescriptor),
      'Relocation committed without returning the exact authoritative descriptor readback',
    );
    require(transferCount === 1, 'Publication retry retransferred an already verified destination bundle');
    require(destination.lifecycle.running && !destination.lifecycle.quarantined, 'Destination was not activated after authoritative readback');
    require(!source.lifecycle.running && source.lifecycle.quarantined, 'Committed relocation reactivated the retained source copy');
  } finally { await Promise.all([source.cleanup(), destination.cleanup()]); }
}
