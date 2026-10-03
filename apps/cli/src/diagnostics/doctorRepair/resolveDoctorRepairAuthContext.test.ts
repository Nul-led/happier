import { afterEach, describe, expect, it, vi } from 'vitest';

import { configuration, reloadConfiguration } from '@/configuration';
import { readSettings, updateSettings, writeCredentialsTokenOnly } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

import { resolveDoctorRepairAuthContext } from './resolveDoctorRepairAuthContext';
import { buildDoctorRepairReport } from './buildDoctorRepairReport';
import { renderAuthentication } from '@/cli/commands/service/repair/sections/renderAuthentication';

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
      envScope.patch({ HAPPIER_ACTIVE_SERVER_ID: 'home-b', HAPPIER_SERVER_URL: 'https://home-b.test', HAPPIER_LOCAL_SERVER_URL: 'http://localhost:43999' });
      reloadConfiguration();
      await writeCredentialsTokenOnly({ token: 'token-home-b' });
      // Explicit scoped reports can target another Home than the process's runtime selection.
      if (targetServerId) {
        envScope.patch({ HAPPIER_ACTIVE_SERVER_ID: 'home-a', HAPPIER_SERVER_URL: 'https://home-a.test', HAPPIER_LOCAL_SERVER_URL: undefined });
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
      expect(fetchBoundary).toHaveBeenCalledWith(`http://127.0.0.1:${targetServerId ? 43123 : 43999}/v1/account/profile`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-home-b' }) }));
      expect(fetchBoundary).toHaveBeenCalledTimes(1);
      expect((await readSettings()).activeServerId).toBe('home-a');
    });
  });

  it.each(['missing', 'invalid', 'valid'] as const)('offers executable repair guidance for a %s runtime-only Home without persisting a profile', async (credentialState) => {
    await withTempDir('doctor-runtime-only-home-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_SERVER_URL: 'https://runtime-only.test', HAPPIER_LOCAL_SERVER_URL: 'http://localhost:43998', HAPPIER_WEBAPP_URL: undefined });
      reloadConfiguration();
      await updateSettings((current) => ({ ...current, servers: { ...current.servers, saved: {
        id: 'saved', name: 'Saved', serverUrl: 'https://saved.test', webappUrl: 'https://saved.test', createdAt: 0, updatedAt: 0, lastUsedAt: 0,
      } } }));
      if (credentialState !== 'missing') await writeCredentialsTokenOnly({ token: 'runtime-only-token' });
      const before = await readSettings();
      const fetchBoundary = vi.fn(async () => new Response(JSON.stringify({ id: 'runtime-account' }), { status: credentialState === 'invalid' ? 401 : 200 }));
      vi.stubGlobal('fetch', fetchBoundary);
      const result = await resolveDoctorRepairAuthContext();
      expect(result.authSignals).toEqual(expect.arrayContaining([
        expect.objectContaining({ serverId: configuration.activeServerId, serverUrl: 'https://runtime-only.test', isActive: true, credentialState }),
      ]));
      const report = await buildDoctorRepairReport({
        ...result,
        currentCli: { releaseChannel: 'dev', ringId: 'publicdev', version: '0.0.0', binaryPath: null, shim: 'hdev', invoker: 'happier', pathWinnerShim: null, pathWinnerResolvesToThisBinary: null },
        automaticStartup: [], currentlyRunning: [], localRelays: [],
        plan: { currentReleaseChannel: 'publicdev', existingServices: [], actions: [], manualWarnings: [] },
        currentServerId: configuration.activeServerId, preferredMode: 'user',
        latestRelayVersionForCurrentChannel: null, platform: 'linux', uid: null,
      });
      const text = renderAuthentication(report.authProfiles, report.hasAnyServerProfile).join('\n');
      expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({
        kind: credentialState === 'valid' ? 'machine_not_registered_for_profile'
          : credentialState === 'invalid' ? 'auth_expired_for_active_profile' : 'auth_missing_for_profile',
        serverId: configuration.activeServerId, isRuntimeOnly: true,
      })]));
      expect(text).toContain(credentialState === 'valid' ? 'happier daemon start' : 'happier auth login');
      expect(text).not.toContain(`--server ${configuration.activeServerId}`);
      expect(text).toContain('happier auth login --server saved');
      if (credentialState !== 'missing') expect(fetchBoundary).toHaveBeenCalledWith('http://127.0.0.1:43998/v1/account/profile', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer runtime-only-token' }) }));
      expect(await readSettings()).toEqual(before);
    });
  });
});
