import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { uninstallRelayRuntimePayloadLocal } from '../../../cli-common/src/firstPartyRuntime/relayRuntimeInstall';
import { verifyPersonalHomeArchive } from '../../../cli-common/src/firstPartyRuntime/personalHome/archive';
import { createPersonalHomeBackupWithLease } from '../../../cli-common/src/firstPartyRuntime/personalHome/backup';
import { resolvePersonalHomeRuntimeLayout } from '../../../cli-common/src/firstPartyRuntime/personalHome/layout';
import {
  createCanonicalPersonalHomeOperations,
  createPersonalHomeSqliteMaintenance,
  inspectPersonalHomeSanitizedConfigurationStorage,
  preparePersonalHomeSanitizedConfiguration,
  readPersonalHomeIdentityFromSqlite,
} from '../../../cli-common/src/firstPartyRuntime/personalHome/productionAdapters';
import { readPersonalHomeRelocationMarker, relocatePersonalHome } from '../../../cli-common/src/firstPartyRuntime/personalHome/relocation';
import { restorePersonalHomeBackupWithLease } from '../../../cli-common/src/firstPartyRuntime/personalHome/restore';
import {
  migrateStagedPersonalHomeSqliteDatabase,
  resolveInstalledPersonalHomeSqliteMigrationPaths,
  type PersonalHomeMigrationProcessRunner,
} from '../../../cli-common/src/firstPartyRuntime/personalHome/stagedMigrationFrontier';
import { readSqliteMigrationCatalog, type SqliteMigrationCatalogEntry } from '../../../cli-common/src/firstPartyRuntime/sqliteMigrationCatalog';
import type { InteractiveSystemTaskKind, InteractiveSystemTaskPromptRequest } from '../../../cli-common/src/systemTasks/interactiveTaskKinds';
import {
  createPersonalHomeBackupTaskKind,
  createPersonalHomeEraseTaskKind,
  createPersonalHomeRelocateTaskKind,
  createPersonalHomeRestoreTaskKind,
  createPersonalHomeSystemTaskOperations,
  createPersonalHomeVerifyBackupTaskKind,
  PERSONAL_HOME_SYSTEM_TASK_KINDS,
  type PersonalHomeTaskBaseParams,
} from '../../../cli-common/src/systemTasks/kinds/relayRuntimeKinds';
import { SystemTaskExecutionError } from '../../../cli-common/src/systemTasks/runSystemTask';
import type { SystemTaskJsonValue } from '@happier-dev/protocol';

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
    `HAPPIER_PUBLIC_SERVER_URL=${purpose.canonicalServerUrl}`,
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
    database.exec('PRAGMA journal_mode=WAL; CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT); CREATE TABLE SessionMessage (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at, rolled_back_at) VALUES (?, ?, CURRENT_TIMESTAMP, NULL)').run(baseline.name, catalog[0]!.checksum);
    database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', data.identity);
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

  const lifecycle = { running: withData, healthResults: [] as boolean[] };
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
      start: async () => { lifecycle.running = true; },
      healthCheck: async () => lifecycle.healthResults.shift() ?? true,
    },
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
  const rollback = await fixture('restore-rollback', true, { identity: 'srv_prior', transcript: 'prior transcript', secret: 'prior secret' }, true);
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
  let quarantined = false;
  let destinationRunning = false;
  try {
    const publicationFailure = new Error('publication failed');
    let observed: unknown;
    try {
      await relocatePersonalHome({
        source: { dataDir: source.layout.dataDir, homeServerIdentityId: 'srv_personal_home_fixture' },
        destination: { dataDir: destination.layout.dataDir },
        platform: 'linux',
        priorSourceRunning: true,
        revalidateSourceUnderLocks: async () => {
          require(source.lifecycle.running === true, 'Relocation source was not running during locked revalidation');
          require(
            (await readPersonalHomeIdentityFromSqlite(source.layout.databasePath, source.catalog)).homeServerIdentityId
              === 'srv_personal_home_fixture',
            'Relocation source identity changed before the final backup',
          );
        },
        prepareDestination: async () => { await mkdir(destination.layout.dataDir, { recursive: true }); },
        stopSource: async () => { source.lifecycle.running = false; },
        startSource: async () => { source.lifecycle.running = true; },
        createFinalBackup: async () => createPersonalHomeBackupWithLease({
          layout: source.layout, outputPath: join(source.layout.backupsDir, 'relocation.tar'), stagingDir: join(source.root, 'relocation-staging'),
          homeServerIdentityId: 'srv_personal_home_fixture', schemaVersion: baseline.name, happierVersion: '0.3-current-source',
          configuration: { canonicalServerUrl: purpose.canonicalServerUrl }, sqlite: await createPersonalHomeSqliteMaintenance(source.layout.databasePath), operationLeaseHeld: true,
        }),
        transfer: { send: async ({ sourcePath, expectedBytes, expectedSha256 }) => {
          const receivedPath = join(destination.root, 'received.tar');
          await copyFile(sourcePath, receivedPath);
          const bytes = await readFile(receivedPath);
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          require(bytes.byteLength === expectedBytes && sha256 === expectedSha256, 'Transfer changed archive bytes');
          return { receivedPath, bytes: bytes.byteLength, sha256 };
        } },
        restoreDestination: async (archivePath) => {
          const result = await restorePersonalHomeBackupWithLease({
            layout: destination.layout, archivePath, operationLeaseHeld: true, expectedHomeServerIdentityId: 'srv_personal_home_fixture', confirmOverwrite: true,
            isSchemaSupported: async (schema) => destination.catalog.some((entry) => entry.name === schema), sqliteMaintenance: createPersonalHomeSqliteMaintenance,
            runMigrations: async (databasePath, manifest) => {
              require(destination.runMigrationProcess, 'Destination lacks migration process');
              await migrateStagedPersonalHomeSqliteDatabase({ layout: destination.layout, databasePath, manifestSchemaVersion: manifest.schemaVersion, runProcess: destination.runMigrationProcess });
            },
            verifyStagedIdentity: async (databasePath, manifest) => (await readPersonalHomeIdentityFromSqlite(databasePath, destination.catalog)).homeServerIdentityId === manifest.homeServerIdentityId,
            inspectConfigurationStorage: (configuration) => inspectPersonalHomeSanitizedConfigurationStorage(destination.layout, configuration),
            prepareConfiguration: (configuration) => preparePersonalHomeSanitizedConfiguration(destination.layout, configuration),
          });
          require(result.outcome === 'restored', 'Destination restore failed');
        },
        verifyDestination: async () => readPersonalHomeIdentityFromSqlite(destination.layout.databasePath, destination.catalog),
        startDestination: async () => { destinationRunning = true; return { healthy: true, homeServerIdentityId: 'srv_personal_home_fixture' }; },
        stopDestination: async () => { destinationRunning = false; },
        quarantineDestination: async () => { quarantined = true; },
        commitSameHomeRelocation: async () => { throw publicationFailure; },
        destinationDescriptor: { v: 1, homeServerIdentityId: 'srv_personal_home_fixture', canonicalServerUrl: 'https://destination.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://destination.example.test' }] },
      });
    } catch (error) { observed = error; }
    require(
      observed === publicationFailure,
      `Publication failure was not surfaced: ${observed instanceof Error ? observed.message : String(observed)}`,
    );
    require(!source.lifecycle.running, 'Publication failure restarted the source instead of keeping it stopped');
    require(!destinationRunning, 'Publication failure left the destination running');
    require(quarantined, 'Publication failure did not quarantine the destination');
    require((await readPersonalHomeRelocationMarker(source.layout.dataDir))?.phase === 'pending', 'Source recovery marker is absent');
    require((await readPersonalHomeRelocationMarker(destination.layout.dataDir))?.phase === 'pending', 'Destination recovery marker is absent');
    require(value(source.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'") === 'real transcript bytes', 'Relocation damaged source bytes');
    require(value(destination.layout.databasePath, "SELECT value FROM SessionMessage WHERE id = 'msg_fixture'") === 'real transcript bytes', 'Relocation did not move destination bytes');

    const operations = createPersonalHomeSystemTaskOperations({ operations: source.operations });
    let unsupported: unknown;
    try {
      await runKind(PERSONAL_HOME_SYSTEM_TASK_KINDS.relocate, { [PERSONAL_HOME_SYSTEM_TASK_KINDS.relocate]: createPersonalHomeRelocateTaskKind({ operations }) }, { ...base(), destination: { targetId: 'machine-destination', descriptor: { v: 1, homeServerIdentityId: 'srv_personal_home_fixture', canonicalServerUrl: 'https://destination.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://destination.example.test' }] } } });
    } catch (error) { unsupported = error; }
    require(unsupported instanceof SystemTaskExecutionError && unsupported.code === 'unsupported', 'Shared task kind did not fail closed without a destination resolver');
  } finally { await Promise.all([source.cleanup(), destination.cleanup()]); }
}
