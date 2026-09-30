import { ensureMachineIdInSettings } from '@/ui/auth';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveBoxPublicKeyFromSeed } from '@happier-dev/protocol';
import { configuration, reloadConfiguration } from '@/configuration';
import { readCredentials, readSettings, updateSettings, writeCredentialsDataKey, writeCredentialsLegacy } from '@/persistence';
import { addServerProfile, useServerProfile } from '@/server/serverProfiles';
import { resolveActiveServerAuthReadiness } from '@/auth/resolveActiveServerAuthReadiness';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const tokenFor = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`;
const scope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'HAPPIER_ACTIVE_SERVER_ID', 'HAPPIER_LOCAL_SERVER_URL', 'HAPPIER_PUBLIC_SERVER_URL']);
afterEach(() => { vi.mocked(writeFile).mockRestore(); scope.restore(); reloadConfiguration(); });

describe('credential publication and account machine selection', () => {
  it.each(['dataKey', 'legacy'] as const)('keeps readiness account-scoped when %s sign-in races profile adoption', async (kind) => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.headers.authorization ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'account-b' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      await withTempDir('credential-account-race-', async (home) => {
        scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: url, HAPPIER_WEBAPP_URL: url, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_LOCAL_SERVER_URL: undefined, HAPPIER_PUBLIC_SERVER_URL: undefined });
        reloadConfiguration();
        const sourceId = configuration.activeServerId;
        const key = new Uint8Array(32).fill(8);
        await writeCredentialsDataKey({ token: tokenFor('account-a'), machineKey: key, publicKey: deriveBoxPublicKeyFromSeed(key) });
        await updateSettings((current) => ({ ...current,
          lastTokenSubByServerId: { [sourceId]: 'account-a' },
          machineIdByServerId: { [sourceId]: 'machine-a' },
          machineIdByServerIdByAccountId: { [sourceId]: { 'account-a': 'machine-a' } },
          machineIdConfirmedByServerByServerId: { [sourceId]: true },
        }));
        scope.patch({ HAPPIER_SERVER_URL: undefined, HAPPIER_WEBAPP_URL: undefined });
        reloadConfiguration();
        await addServerProfile({ name: 'target', serverUrl: url, webappUrl: url, use: false });
        // Select the target for the concurrent auth writer without triggering adoption.
        scope.patch({ HAPPIER_ACTIVE_SERVER_ID: 'target' });
        reloadConfiguration();
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        let signIn: Promise<void> | undefined;
        vi.mocked(writeFile).mockImplementation(async (...args: Parameters<typeof writeFile>) => {
          if (!signIn && String(args[0]).includes('settings.json') && String(args[1]).includes('"target": "account-a"')) {
            signIn = kind === 'dataKey'
              ? writeCredentialsDataKey({ token: tokenFor('account-b'), machineKey: key, publicKey: deriveBoxPublicKeyFromSeed(key) })
              : writeCredentialsLegacy({ token: tokenFor('account-b'), secret: key });
            // Hold the real settings publication at the reproduced filesystem interleaving.
            // The bounded gate permits a correctly serialized writer to await this commit.
            await Promise.race([signIn, new Promise<void>((resolve) => setTimeout(resolve, 50))]);
          }
          return actual.writeFile(...args);
        });
        await useServerProfile('target');
        expect(signIn).toBeDefined();
        await signIn;
        reloadConfiguration();
        expect((await readCredentials())?.token).toBe(tokenFor('account-b'));
        const readiness = await resolveActiveServerAuthReadiness();
        expect(readiness.authenticated).toBe(true);
        expect(readiness.machineRegistered).toBe(false);
        expect(readiness.machineId).toBeNull();
        const settings = await readSettings();
        expect(settings.lastTokenSubByServerId?.target).toBe('account-b');
        expect(settings.machineIdByServerIdByAccountId?.target?.['account-a']).toBe('machine-a');
        expect(settings.machineIdConfirmedByServerByServerId?.target).toBeUndefined();
        expect(requests).toEqual([`Bearer ${tokenFor('account-b')}`]);
        expect(JSON.parse(await readFile(join(home, 'servers', 'target', 'access.key'), 'utf8')).token).toBe(tokenFor('account-b'));
      });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it('retains account history and reports a missing matching machine after credential publication survives a failed state write', async () => {
    const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'account-b' })); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      await withTempDir('credential-state-write-failure-', async (home) => {
        scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: url, HAPPIER_WEBAPP_URL: url, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_LOCAL_SERVER_URL: undefined, HAPPIER_PUBLIC_SERVER_URL: undefined });
        reloadConfiguration();
        const serverId = configuration.activeServerId;
        const key = new Uint8Array(32).fill(8);
        await writeCredentialsLegacy({ token: tokenFor('account-a'), secret: key });
        await updateSettings((current) => ({ ...current, lastTokenSubByServerId: { [serverId]: 'account-a' }, machineIdByServerId: { [serverId]: 'machine-a' }, machineIdByServerIdByAccountId: { [serverId]: { 'account-a': 'machine-a' } } }));
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        vi.mocked(writeFile).mockImplementation(async (...args: Parameters<typeof writeFile>) => {
          if (String(args[0]).includes('settings.json')) throw new Error('Injected settings write failure');
          return actual.writeFile(...args);
        });
        await expect(writeCredentialsLegacy({ token: tokenFor('account-b'), secret: key })).rejects.toThrow('Injected settings write failure');
        expect((await readCredentials())?.token).toBe(tokenFor('account-b'));
        expect((await readSettings()).lastTokenSubByServerId?.[serverId]).toBe('account-a');
        const readiness = await resolveActiveServerAuthReadiness();
        expect(readiness.authenticated).toBe(true);
        expect(readiness.machineId).toBeNull();
        expect(readiness.machineRegistered).toBe(false);
        vi.mocked(writeFile).mockRestore();
        await writeCredentialsLegacy({ token: tokenFor('account-b'), secret: key });
        expect((await readSettings()).lastTokenSubByServerId?.[serverId]).toBe('account-b');
        expect((await readSettings()).machineIdByServerIdByAccountId?.[serverId]?.['account-a']).toBe('machine-a');
      });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it('selects an existing account identity without allocating one and preserves opaque-token metadata', async () => {
    await withTempDir('credential-account-history-', async (home) => {
      scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: 'https://history.example.test', HAPPIER_WEBAPP_URL: undefined, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_LOCAL_SERVER_URL: undefined, HAPPIER_PUBLIC_SERVER_URL: undefined });
      reloadConfiguration();
      const serverId = configuration.activeServerId;
      await updateSettings((current) => ({ ...current, lastTokenSubByServerId: { [serverId]: 'account-a' }, machineIdByServerId: { [serverId]: 'machine-a' }, machineIdByServerIdByAccountId: { [serverId]: { 'account-a': 'machine-a', 'account-b': 'machine-b' } } }));
      await writeCredentialsLegacy({ token: tokenFor('account-b'), secret: new Uint8Array(32) });
      const selected = await readSettings();
      expect(selected.machineId).toBe('machine-b');
      expect(selected.machineIdByServerIdByAccountId?.[serverId]).toEqual({ 'account-a': 'machine-a', 'account-b': 'machine-b' });
      await writeCredentialsLegacy({ token: 'legacy-opaque-token', secret: new Uint8Array(32) });
      const opaque = await readSettings();
      expect(opaque.lastTokenSubByServerId).toEqual(selected.lastTokenSubByServerId);
      expect(opaque.machineIdByServerIdByAccountId).toEqual(selected.machineIdByServerIdByAccountId);
      expect(opaque.machineIdByServerId).toEqual(selected.machineIdByServerId);
    });
  });

  it.each([
    { previousAccountId: 'account-b', expectedMachineId: 'legacy-machine' },
    { previousAccountId: 'account-a', expectedMachineId: undefined },
  ])('preserves legacy aggregate backfill only without an identified account swap ($previousAccountId)', async ({ previousAccountId, expectedMachineId }) => {
    await withTempDir('credential-legacy-account-boundary-', async (home) => {
      scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: 'https://legacy.example.test', HAPPIER_WEBAPP_URL: undefined, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_LOCAL_SERVER_URL: undefined, HAPPIER_PUBLIC_SERVER_URL: undefined });
      reloadConfiguration();
      const serverId = configuration.activeServerId;
      await updateSettings((current) => ({ ...current, lastTokenSubByServerId: { [serverId]: previousAccountId }, machineIdByServerId: { [serverId]: 'legacy-machine' }, machineIdByServerIdByAccountId: {} }));
      await writeCredentialsLegacy({ token: tokenFor('account-b'), secret: new Uint8Array(32) });
      const selected = await readSettings();
      expect(selected.machineId).toBe(expectedMachineId);
      expect(selected.lastTokenSubByServerId?.[serverId]).toBe('account-b');
      expect(selected.machineIdByServerIdByAccountId?.[serverId]?.['account-b']).toBe(expectedMachineId);
    });
  });

  it('does not backfill a known account from historical identity after opaque setup cleared the recorded subject', async () => {
    const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'account-b' })); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      await withTempDir('credential-opaque-account-transition-', async (home) => {
        scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: url, HAPPIER_WEBAPP_URL: url, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_LOCAL_SERVER_URL: undefined, HAPPIER_PUBLIC_SERVER_URL: undefined });
        reloadConfiguration();
        const serverId = configuration.activeServerId;
        await updateSettings((current) => ({ ...current, lastTokenSubByServerId: { [serverId]: 'account-a' }, machineIdByServerId: { [serverId]: 'machine-a' }, machineIdByServerIdByAccountId: { [serverId]: { 'account-a': 'machine-a' } } }));
        await ensureMachineIdInSettings();
        const opaqueState = await readSettings();
        expect(opaqueState.lastTokenSubByServerId?.[serverId]).toBeUndefined();
        expect(opaqueState.machineIdByServerIdByAccountId?.[serverId]?.['account-a']).toBe('machine-a');
        await writeCredentialsLegacy({ token: tokenFor('account-b'), secret: new Uint8Array(32) });
        const readiness = await resolveActiveServerAuthReadiness();
        expect(readiness.authenticated).toBe(true);
        expect(readiness.machineRegistered).toBe(false);
        expect(readiness.machineId).toBeNull();
        const after = await readSettings();
        expect(after.machineIdByServerIdByAccountId?.[serverId]?.['account-a']).toBe('machine-a');
        expect(after.machineIdByServerIdByAccountId?.[serverId]?.['account-b']).toBeUndefined();
      });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
