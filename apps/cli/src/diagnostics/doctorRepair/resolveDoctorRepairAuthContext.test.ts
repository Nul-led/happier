import { afterEach, describe, expect, it, vi } from 'vitest';

import { reloadConfiguration } from '@/configuration';
import { readSettings, updateSettings, writeCredentialsTokenOnly } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

import { resolveDoctorRepairAuthContext } from './resolveDoctorRepairAuthContext';

describe('doctor repair auth context', () => {
  const envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_ACTIVE_SERVER_ID', 'HAPPIER_SERVER_URL', 'HAPPIER_LOCAL_SERVER_URL', 'HAPPIER_WEBAPP_URL']);
  afterEach(() => {
    envScope.restore();
    reloadConfiguration();
    vi.unstubAllGlobals();
  });

  it.each([null, 'home-b'])('probes the selected profile %s without changing the terminal selection', async (targetServerId) => {
    await withTempDir('doctor-selected-home-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_SERVER_URL: undefined, HAPPIER_LOCAL_SERVER_URL: undefined, HAPPIER_WEBAPP_URL: undefined });
      reloadConfiguration();
      const profile = (id: string) => ({ id, name: id, serverUrl: `https://${id}.test`, localServerUrl: id === 'home-b' ? 'http://localhost:43123/' : undefined, webappUrl: `https://${id}.test`, createdAt: 0, updatedAt: 0, lastUsedAt: 0 });
      await updateSettings((current) => ({ ...current, activeServerId: 'home-a', servers: { ...current.servers, 'home-a': profile('home-a'), 'home-b': profile('home-b') } }));
      reloadConfiguration();
      await writeCredentialsTokenOnly({ token: 'token-home-a' });
      envScope.patch({ HAPPIER_ACTIVE_SERVER_ID: 'home-b' });
      reloadConfiguration();
      await writeCredentialsTokenOnly({ token: 'token-home-b' });
      // Explicit scoped reports can target another Home than the process's runtime selection.
      if (targetServerId) {
        envScope.patch({ HAPPIER_ACTIVE_SERVER_ID: 'home-a' });
        reloadConfiguration();
      }
      const fetchBoundary = vi.fn(async () => new Response(JSON.stringify({ id: 'account-b' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchBoundary);
      const result = await resolveDoctorRepairAuthContext({ targetServerId });
      expect(result.authSignals).toEqual(expect.arrayContaining([
        expect.objectContaining({ serverId: 'home-b', isActive: true, credentialState: 'valid', machineRegistered: false }),
        expect.objectContaining({ serverId: 'home-a', isActive: false, credentialState: 'stored-unverified' }),
      ]));
      expect(result.activeServerUrl).toBe('https://home-b.test');
      expect(fetchBoundary).toHaveBeenCalledWith('http://127.0.0.1:43123/v1/account/profile', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-home-b' }) }));
      expect(fetchBoundary).toHaveBeenCalledTimes(1);
      expect((await readSettings()).activeServerId).toBe('home-a');
    });
  });
});
