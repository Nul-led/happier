import { describe, expect, it } from 'vitest';

import { planDaemonServiceLifecycle } from './plan';

/**
 * R12 convergence reinstalls another service onto the chosen CLI and then stops a service that
 * was not running. That stop must leave its at-login/on-demand preference alone: service activity
 * is independent from the login trigger on every platform.
 */
describe('service stop keeps the service enabled at login (R12 convergence)', () => {
  const disablesAutostart = (command: Readonly<{ cmd: string; args: readonly string[] }>) => {
    const line = [command.cmd, ...command.args].join(' ');
    return /\bdisable\b|unload\s+-w|Disable-ScheduledTask|\/DISABLE|Unregister-ScheduledTask|\/Delete/iu.test(line);
  };

  it.each(['linux', 'darwin', 'win32'] as const)('on %s stops without disabling', (platform) => {
    const plan = planDaemonServiceLifecycle({
      platform,
      action: 'stop',
      channel: 'stable',
      targetMode: 'pinned',
      instanceId: 'company',
      userHomeDir: platform === 'win32' ? 'C:\\Users\\test' : '/home/test',
      happierHomeDir: platform === 'win32' ? 'C:\\Users\\test\\.happier' : '/home/test/.happier',
      uid: 501,
    });

    expect(plan.commands.length).toBeGreaterThan(0);
    expect(plan.commands.filter(disablesAutostart)).toEqual([]);
  });
});
