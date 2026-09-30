import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveBoxPublicKeyFromSeed } from '@happier-dev/protocol';
import { configuration, reloadConfiguration } from '@/configuration';
import { updateSettings, writeCredentialsDataKey } from '@/persistence';
import { applyEphemeralServerSelectionFromPrefixArgs } from '@/server/serverSelection';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { resolveDoctorRepairAuthContext } from './resolveDoctorRepairAuthContext';
import { classifyAuth } from './classifyAuth';

const scope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'HAPPIER_ACTIVE_SERVER_ID', 'HAPPIER_LOCAL_SERVER_URL', 'HAPPIER_PUBLIC_SERVER_URL']);
afterEach(() => { scope.restore(); reloadConfiguration(); });

describe('doctor repair auth profile scope', () => {
  it('uses the selected profile credentials and API endpoint, preserving the saved active profile', async () => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.headers.authorization ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'account-a' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Missing server address');
    const localUrl = `http://127.0.0.1:${addr.port}`;
    try {
      await withTempDir('doctor-profile-scope-', async (home) => {
        scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: undefined, HAPPIER_WEBAPP_URL: undefined, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_PUBLIC_SERVER_URL: undefined, HAPPIER_LOCAL_SERVER_URL: undefined });
        reloadConfiguration();
        await updateSettings((s) => ({ ...s, activeServerId: 'empty', servers: {
          empty: { id: 'empty', name: 'Empty alias', serverUrl: 'https://relay.example.test', webappUrl: 'https://relay.example.test', localServerUrl: localUrl, createdAt: 1, updatedAt: 1, lastUsedAt: 1 },
          paired: { id: 'paired', name: 'Paired alias', serverUrl: 'https://relay.example.test', webappUrl: 'https://relay.example.test', localServerUrl: localUrl, createdAt: 1, updatedAt: 1, lastUsedAt: 1 },
        }, machineIdByServerId: { paired: 'machine-a' } }));
        reloadConfiguration();
        await applyEphemeralServerSelectionFromPrefixArgs(['--server', 'paired', 'status']);
        const machineKey = new Uint8Array(32).fill(8);
        await writeCredentialsDataKey({ token: 'test-token', machineKey, publicKey: deriveBoxPublicKeyFromSeed(machineKey) });
        const context = await resolveDoctorRepairAuthContext();
        expect(context.authSignals.find((s) => s.serverId === 'paired')).toMatchObject({ isActive: true, hasCredentials: true, reachability: 'verified', machineRegistered: true });
        expect(context.authSignals.find((s) => s.serverId === 'empty')).toMatchObject({ isActive: false, hasCredentials: false, reachability: 'not-probed' });
        expect(classifyAuth({ hasAnyServerProfile: context.hasAnyServerProfile, signals: context.authSignals })).toEqual([]);
        expect(requests).toEqual(['Bearer test-token']);
        const { readSettings } = await import('@/persistence');
        expect((await readSettings()).activeServerId).toBe('empty');
        await applyEphemeralServerSelectionFromPrefixArgs(['--server', 'empty', 'status']);
        const empty = await resolveDoctorRepairAuthContext();
        expect(empty.authSignals.find((s) => s.serverId === 'empty')).toMatchObject({ isActive: true, hasCredentials: false });
        expect(classifyAuth({ hasAnyServerProfile: empty.hasAnyServerProfile, signals: empty.authSignals })).toMatchObject([{ kind: 'auth_missing_for_profile', serverId: 'empty' }]);
        expect(requests).toHaveLength(1);
      });
    } finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
  });
});
