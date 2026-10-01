import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  failWritePath: null as string | null,
  commands: [] as Array<{ command: string; args: readonly string[] }>,
}));
// Only filesystem failure and OS service commands are replaced; planner and installer stay real.
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
    if (String(args[0]) === boundary.failWritePath) {
      boundary.failWritePath = null;
      throw new Error('replacement definition write failed');
    }
    return await actual.writeFile(...args);
  } };
});
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawnSync: (command: string, args: readonly string[]) => {
    boundary.commands.push({ command, args });
    return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
  },
}));

import { planDaemonServiceInstall } from '@/daemon/service/plan';
import { readInstalledDaemonServiceInstallOptions, readInstalledDaemonServiceManagedBy } from '@/daemon/service/discoverInstalledDaemonServiceEntries';
import { buildBackgroundServiceRepairPlan } from './buildBackgroundServiceRepairPlan';
import { applyBackgroundServiceRepairPlan } from './applyBackgroundServiceRepairPlan';

afterEach(() => { vi.unstubAllEnvs(); boundary.failWritePath = null; boundary.commands.length = 0; });

it.each([false, true])('preserves the prior login trigger, bundle attribution and ownership through repair (rollback=%s)', async (rollback) => {
  const home = await mkdtemp(join(tmpdir(), 'repair-definition-metadata-'));
  try {
    const happierHomeDir = join(home, '.happier');
    const runtime = { platform: 'linux' as const, uid: 501, systemUser: '', userHomeDir: home, happierHomeDir };
    vi.stubEnv('HAPPIER_HOME_DIR', happierHomeDir);
    vi.stubEnv('HAPPIER_DAEMON_SERVICE_USER_HOME_DIR', home);
    const bin = join(home, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'systemctl'), '');
    await chmod(join(bin, 'systemctl'), 0o755);
    vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`);
    const prior = planDaemonServiceInstall({
      ...runtime, channel: 'preview', targetMode: 'default-following', instanceId: 'default',
      serverUrl: 'https://company.test', webappUrl: 'https://company.test', publicServerUrl: 'https://company.test',
      nodePath: process.execPath, entryPath: '/opt/happier/index.mjs',
      autostart: 'on-demand', bundleId: 'dev.happier.preview', managedBy: 'desktop',
    });
    const canonical = prior.files[0]!;
    const legacyPath = join(home, '.config', 'systemd', 'user', 'happier-daemon.preview.default.service');
    await mkdir(join(home, '.config', 'systemd', 'user'), { recursive: true });
    await writeFile(legacyPath, canonical.content);
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview', currentHappierHomeDir: happierHomeDir, currentServerId: 'company', preferredMode: 'user',
      services: [{
        serverId: 'default', name: 'Legacy default', installed: true, path: legacyPath, platform: 'linux', mode: 'user',
        happierHomeDir, releaseChannel: 'preview', label: 'happier-daemon.preview.default', targetMode: 'default-following',
        installedDefinitionMatchesExpected: false,
      }],
    });
    expect(plan.actions).toEqual([expect.objectContaining({ kind: 'remove-service' }), expect.objectContaining({ kind: 'install-default-following-service' })]);
    if (rollback) boundary.failWritePath = canonical.path;
    const repair = applyBackgroundServiceRepairPlan(plan, runtime);
    if (rollback) await expect(repair).rejects.toThrow('replacement definition write failed');
    else await repair;

    expect(readInstalledDaemonServiceInstallOptions({ platform: 'linux', path: canonical.path }))
      .toEqual({ autostart: 'on-demand', bundleId: 'dev.happier.preview' });
    expect(readInstalledDaemonServiceManagedBy({ platform: 'linux', path: canonical.path })).toBe('desktop');
    expect(await readFile(canonical.path, 'utf8')).toContain('HAPPIER_DAEMON_SERVICE_AUTOSTART=on-demand');
    expect(boundary.commands.some(({ command, args }) => command === 'systemctl' && args.includes('enable'))).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
