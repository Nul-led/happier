import { describe, expect, it } from 'vitest';

import { planDaemonServiceInstall } from './plan';

/**
 * R12 convergence reinstalls another service of this home onto the chosen CLI. A service the person
 * disabled (it does not start at login) must stay disabled: `enablement: 'disabled'` rewrites the
 * definition without starting a stopped service. A running disabled service resumes on the chosen
 * CLI and stays disabled at login. The default install keeps enabling and (re)starting as before.
 */
describe('service install keeps a disabled service disabled (R12 convergence)', () => {
  const base = (platform: 'linux' | 'darwin' | 'win32') => ({
    platform,
    channel: 'stable' as const,
    targetMode: 'pinned' as const,
    instanceId: 'company',
    activeServerId: 'company',
    uid: 501,
    userHomeDir: platform === 'win32' ? 'C:\\Users\\test' : '/home/test',
    happierHomeDir: platform === 'win32' ? 'C:\\Users\\test\\.happier' : '/home/test/.happier',
    serverUrl: 'https://company.example.test',
    webappUrl: 'https://company.example.test',
    publicServerUrl: 'https://company.example.test',
    nodePath: '/npm/happier',
    entryPath: '',
  });
  const lines = (plan: Readonly<{ commands: ReadonlyArray<Readonly<{ cmd: string; args: readonly string[] }>> }>) => (
    plan.commands.map((command) => [command.cmd, ...command.args].join(' '))
  );
  // What would turn the service on at login or start it now.
  const enables: Record<'linux' | 'darwin' | 'win32', RegExp> = {
    linux: /systemctl .*\b(?:enable|restart|start)\b/u,
    darwin: /launchctl (?:enable|bootstrap|kickstart|load)\b/u,
    win32: /schtasks \/Run\b|Enable-ScheduledTask/u,
  };
  const disables: Record<'linux' | 'darwin' | 'win32', RegExp> = {
    linux: /systemctl .*\bdisable\b/u,
    darwin: /launchctl disable\b/u,
    win32: /Disable-ScheduledTask/u,
  };

  it.each(['linux', 'darwin', 'win32'] as const)('on %s rewrites the definition without enabling or starting it', (platform) => {
    const kept = lines(planDaemonServiceInstall({ ...base(platform), enablement: 'disabled' }));
    expect(kept.filter((line) => enables[platform].test(line) && !/try-restart/u.test(line))).toEqual([]);
    expect(kept.some((line) => disables[platform].test(line))).toBe(true);

    // Control: the ordinary install still enables and starts it.
    expect(lines(planDaemonServiceInstall(base(platform))).some((line) => enables[platform].test(line))).toBe(true);
  });

  it.each(['linux', 'darwin', 'win32'] as const)('on %s keeps a disabled-but-running service running while leaving it disabled', (platform) => {
    const kept = lines(planDaemonServiceInstall({
      ...base(platform),
      enablement: 'disabled',
      preserveRunningWhenDisabled: true,
    }));
    const startIndex = kept.findIndex((line) => platform === 'linux'
      ? /systemctl .*\btry-restart\b/u.test(line)
      : platform === 'darwin'
        ? /launchctl kickstart\b/u.test(line)
        : /schtasks \/Run\b/u.test(line));
    const disableIndex = kept.reduce((lastIndex, line, index) => disables[platform].test(line) ? index : lastIndex, -1);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(disableIndex).toBeGreaterThanOrEqual(0);
    if (platform !== 'linux') expect(disableIndex).toBeGreaterThan(startIndex);
  });
});
