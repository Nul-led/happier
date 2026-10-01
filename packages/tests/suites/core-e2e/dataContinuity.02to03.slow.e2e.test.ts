import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import * as tar from 'tar';
import { afterAll, describe, expect, it } from 'vitest';

import { waitForOkHealth } from '../../src/testkit/http';
import { repoRootDir } from '../../src/testkit/paths';
import { spawnLoggedProcess, type SpawnedProcess } from '../../src/testkit/process/spawnProcess';
import { resolveTsxImportHookSpecifier } from '../../src/testkit/process/tsxImportHook';
import { createRunDirs } from '../../src/testkit/runDir';

const root = repoRootDir();
const fixtureDir = join(root, 'packages/tests/fixtures/continuity-0.2');
const archivePath = join(fixtureDir, 'home-and-client.tar.gz');
// Produced by ../0.2 at ff95c165f6d4be5efa220d050f03d54e826d1526.
const archiveSha256 = '287001864115c82c8dd3ba6caaf3ba722d23390db31ceaa666b7f9b8403a1d4c';
const sessions = [
  ['cmul9ttpl0002f89g2ww4k6vv', 'historical dataKey message 1'],
  ['cmul9ttrn0006f89g52gw6kfd', 'historical dataKey message 2'],
  ['cmul9ttte000af89gzut7f2i0', 'historical dataKey message 3'],
] as const;
const legacySession = ['cmulcrx760002f8hdx67wcq6r', 'historical legacy-secret message'] as const;
const run = createRunDirs({ runLabel: 'continuity-02-to-03' });
const execFileAsync = promisify(execFile);

async function availableLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port allocated');
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function databaseCounts(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
    return {
      accounts: count('Account'),
      machines: count('Machine'),
      sessions: count('Session'),
      messages: count('SessionMessage'),
      migrations: count('_prisma_migrations'),
    };
  } finally {
    db.close();
  }
}

describe('0.2 E2EE Accounts survive the one-way 0.3 upgrade', () => {
  let server: SpawnedProcess | null = null;

  afterAll(async () => {
    await server?.stop();
  });

  it('opens data-key data and recovers a legacy-secret Account without losing its encrypted message', async () => {
    const testDir = run.testDir('historical-data-key-home');
    const archive = await readFile(archivePath);
    expect(createHash('sha256').update(archive).digest('hex')).toBe(archiveSha256);
    await tar.x({ file: archivePath, cwd: testDir, strict: true });

    const serverDataDir = join(testDir, 'server-light-data');
    const cliHome = join(testDir, 'client-home');
    await mkdir(serverDataDir, { recursive: true });
    await mkdir(join(cliHome, 'servers/cloud'), { recursive: true });
    await cp(join(testDir, 'server-02/happier-server-light.sqlite'), join(serverDataDir, 'happier-server-light.sqlite'));
    await cp(join(testDir, 'server-02/handy-master-secret.txt'), join(serverDataDir, 'handy-master-secret.txt'));
    await cp(join(testDir, 'client-02-data/servers/cloud/access.key'), join(cliHome, 'servers/cloud/access.key'));

    const dbPath = join(serverDataDir, 'happier-server-light.sqlite');
    expect(databaseCounts(dbPath)).toEqual({ accounts: 3, machines: 3, sessions: 7, messages: 7, migrations: 54 });

    const savedState = JSON.parse(await readFile(join(testDir, 'client-02-data/settings.json'), 'utf8')) as {
      activeServerId: string;
      servers: { cloud: { id: string; name: string; serverUrl: string; webappUrl: string } };
    };
    expect(savedState.activeServerId).toBe('cloud');
    expect(savedState.servers.cloud).toMatchObject({ id: 'cloud', name: 'Happier Cloud', serverUrl: 'http://127.0.0.1:39357' });

    const port = await availableLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    // Retarget only the copied test profile to the ephemeral loopback port.
    await writeFile(join(cliHome, 'settings.json'), JSON.stringify({
      ...savedState,
      servers: { ...savedState.servers, cloud: { ...savedState.servers.cloud, serverUrl: baseUrl, webappUrl: baseUrl } },
    }));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      PUBLIC_URL: baseUrl,
      HAPPIER_CANONICAL_SERVER_URL: baseUrl,
      METRICS_ENABLED: 'false',
      HAPPIER_DB_PROVIDER: 'sqlite',
      HAPPY_DB_PROVIDER: 'sqlite',
      HAPPIER_SERVER_HOST: '127.0.0.1',
      HAPPY_SERVER_HOST: '127.0.0.1',
      HAPPIER_SERVER_LIGHT_DATA_DIR: serverDataDir,
      HAPPY_SERVER_LIGHT_DATA_DIR: serverDataDir,
      HAPPIER_SERVER_LIGHT_FILES_DIR: join(serverDataDir, 'files'),
      HAPPY_SERVER_LIGHT_FILES_DIR: join(serverDataDir, 'files'),
      HAPPIER_SQLITE_AUTO_MIGRATE: '1',
      HAPPIER_SQLITE_MIGRATIONS_DIR: join(root, 'apps/server/prisma/sqlite/migrations'),
      HAPPIER_UPDATER_FORWARD_RECOVERY_CAPABILITY: 'personal-home-update-record-v1',
    };
    server = spawnLoggedProcess({
      command: 'bun',
      args: ['--tsconfig-override', join(root, 'apps/server/tsconfig.json'), join(root, 'apps/server/sources/main.light.ts')],
      cwd: root,
      env,
      stdoutPath: join(testDir, 'server.stdout.log'),
      stderrPath: join(testDir, 'server.stderr.log'),
    });
    await waitForOkHealth(baseUrl, { timeoutMs: 90_000 });

    expect(databaseCounts(dbPath)).toMatchObject({ accounts: 3, machines: 3, sessions: 7, messages: 7 });
    expect(databaseCounts(dbPath).migrations).toBeGreaterThan(54);

    const clientEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HAPPIER_HOME_DIR: cliHome,
      HAPPIER_ACTIVE_SERVER_ID: 'cloud',
      HAPPIER_SERVER_URL: baseUrl,
      HAPPIER_LOCAL_SERVER_URL: baseUrl,
      HAPPIER_WEBAPP_URL: baseUrl,
      HAPPIER_STACK_CLI_ROOT_DISABLE: '1',
      HAPPIER_CONTINUITY_HOME_URL: baseUrl,
      HAPPIER_DISABLE_AUTO_UPDATE: '1',
      TSX_TSCONFIG_PATH: join(root, 'apps/cli/tsconfig.json'),
    };
    const tsxHook = resolveTsxImportHookSpecifier();
    if (!tsxHook) throw new Error('Current CLI source requires the tsx import hook');
    const runCli = async (args: string[]) => {
      let result;
      try {
        result = await execFileAsync(process.execPath, [
          '--import', tsxHook, join(root, 'apps/cli/src/index.ts'), ...args,
        ], { cwd: root, env: clientEnv, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      } catch (error) {
        const failure = error as Error & { code?: string; signal?: string; stdout?: string; stderr?: string };
        throw new Error(`CLI command failed: ${args[0]} ${args[1]} (${failure.code ?? failure.signal ?? 'unknown'}): ${failure.stdout ?? ''} ${failure.stderr ?? ''}`);
      }
      return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    };

    const list = await runCli(['session', 'list', '--json', '--limit', '10']);
    expect(list).toMatchObject({ ok: true, kind: 'session_list' });
    const listedSessions = (list.data as { sessions: Array<{ id: string }> }).sessions;
    expect(listedSessions.map((session) => session.id).sort()).toEqual(sessions.map(([id]) => id).sort());

    const histories = await Promise.all(sessions.map(async ([id]) => await runCli([
      'session', 'history', id, '--format', 'raw', '--json',
    ])));
    histories.forEach((history, index) => {
      expect(history).toMatchObject({ ok: true, kind: 'session_history' });
      expect(history.data).toMatchObject({
        sessionId: sessions[index]![0],
        messages: [{ raw: { content: { type: 'text', text: sessions[index]![1] } } }],
      });
    });

    const renderedHistories = await Promise.all(sessions.map(async ([id]) => await runCli([
      'session', 'history', id, '--json',
    ])));
    renderedHistories.forEach((history, index) => {
      expect(history.data).toMatchObject({
        sessionId: sessions[index]![0],
        format: 'compact',
        messages: [{ text: sessions[index]![1] }],
      });
    });

    const legacyCredentialPath = join(testDir, 'client-02-legacy/servers/cloud/access.key');
    const legacyCredential = JSON.parse(await readFile(legacyCredentialPath, 'utf8')) as { secret: string; token: string };
    expect(typeof legacyCredential.token).toBe('string');
    const legacyCliHome = join(testDir, 'client-home-legacy');
    await mkdir(join(legacyCliHome, 'servers/cloud'), { recursive: true });
    await cp(legacyCredentialPath, join(legacyCliHome, 'servers/cloud/access.key'));
    await writeFile(join(legacyCliHome, 'settings.json'), JSON.stringify({
      ...savedState,
      lastTokenSubByServerId: {},
      servers: { ...savedState.servers, cloud: { ...savedState.servers.cloud, serverUrl: baseUrl, webappUrl: baseUrl } },
    }));
    clientEnv.HAPPIER_HOME_DIR = legacyCliHome;
    const beforeRepair = await fetch(`${baseUrl}/v1/account/encryption/currentness`, {
      headers: { Authorization: `Bearer ${legacyCredential.token}` },
    });
    expect(await beforeRepair.json()).toMatchObject({
      error: 'migration-required',
      recipientEnvelopeReadiness: { status: 'unavailable', reason: 'encryption_setup_required' },
    });
    const features = await fetch(`${baseUrl}/v1/features/authenticated`, {
      headers: { Authorization: `Bearer ${legacyCredential.token}` },
    });
    expect(await features.json()).toMatchObject({
      capabilities: { serverIdentity: { serverIdentityId: expect.any(String) } },
    });
    const legacyStatus = await runCli(['auth', 'status', '--json']);
    expect(legacyStatus).toMatchObject({ ok: true, kind: 'auth_status' });
    const afterBoot = await fetch(`${baseUrl}/v1/account/encryption/currentness`, {
      headers: { Authorization: `Bearer ${legacyCredential.token}` },
    });
    expect(afterBoot.status).toBe(200);
    const legacyList = await runCli(['session', 'list', '--json', '--limit', '10']);
    expect(legacyList).toMatchObject({ ok: true, kind: 'session_list' });
    expect((legacyList.data as { sessions: Array<{ id: string }> }).sessions.map((session) => session.id))
      .toContain(legacySession[0]);
    const savedLegacyCredential = JSON.parse(await readFile(join(legacyCliHome, 'servers/cloud/access.key'), 'utf8')) as { secret: string; token: string };
    expect(savedLegacyCredential).toEqual(legacyCredential);
    const currentness = await fetch(`${baseUrl}/v1/account/encryption/currentness`, {
      headers: { Authorization: `Bearer ${savedLegacyCredential.token}` },
    });
    expect(currentness.status).toBe(200);

    const directMessages = await fetch(`${baseUrl}/v1/sessions/${legacySession[0]}/messages`, {
      headers: { Authorization: `Bearer ${savedLegacyCredential.token}` },
    });
    expect(directMessages.status).toBe(200);
    expect(await directMessages.json()).toMatchObject({ messages: [expect.anything()] });
    const legacyHistory = await runCli(['session', 'history', legacySession[0], '--format', 'raw', '--json']);
    expect(legacyHistory).toMatchObject({
      ok: true,
      data: { messages: [{ raw: { content: { type: 'text', text: legacySession[1] } } }] },
    });

    clientEnv.HAPPIER_HOME_DIR = cliHome;
    const reader = await execFileAsync(process.execPath, [
      '--import', tsxHook, join(root, 'packages/tests/scripts/verify-0.2-continuity-reader.mjs'),
    ], { cwd: root, env: clientEnv, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    expect(JSON.parse(reader.stdout.trim())).toEqual({
      kind: 'continuity_readers',
      machineId: 'b77c9eb9-2b91-4778-b509-f90e63c7ae44',
      settingsVersion: 1,
      cloudProfileId: 'cloud',
    });
  }, 180_000);
});
