import { describe, expect, it } from 'vitest';

import { planServiceAction } from './manager.js';

describe('planServiceAction (durable service authority)', () => {
  it.each([
    ['systemd-user', 'systemctl', ['--user', 'disable', '--now', 'happier-server.service']],
    ['systemd-system', 'systemctl', ['disable', '--now', 'happier-server.service']],
  ] as const)('quarantines %s by disabling and stopping the unit', (backend, cmd, args) => {
    const plan = planServiceAction({
      backend,
      action: 'quarantine',
      label: 'happier-server',
      definitionPath: '/tmp/happier-server.service',
    });

    expect(plan.commands).toEqual([expect.objectContaining({ cmd, args })]);
  });

  it('quarantines launchd by disabling and booting out the service', () => {
    const plan = planServiceAction({
      backend: 'launchd-user',
      action: 'quarantine',
      label: 'happier-server',
      definitionPath: '/Users/alice/Library/LaunchAgents/happier-server.plist',
      uid: 501,
    });

    expect(plan.commands).toEqual([
      expect.objectContaining({ cmd: 'launchctl', args: ['disable', 'gui/501/happier-server'] }),
      expect.objectContaining({ cmd: 'launchctl', args: ['bootout', 'gui/501', '/Users/alice/Library/LaunchAgents/happier-server.plist'] }),
      expect.objectContaining({ cmd: 'launchctl', args: ['remove', 'happier-server'] }),
    ]);
  });

  it('quarantines Windows by disabling the scheduled task before stopping its process tree', () => {
    const plan = planServiceAction({
      backend: 'schtasks-user',
      action: 'quarantine',
      label: 'happier-server',
      taskName: 'Happier\\happier-server',
      definitionPath: 'C:\\Users\\alice\\.happier\\services\\happier-server.ps1',
    });

    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]).toMatchObject({ cmd: 'powershell.exe' });
    expect(plan.commands[0]?.args.at(-1)).toContain('Disable-ScheduledTask');
    expect(plan.commands[1]?.args.at(-1)).toContain('Stop-ScheduledTask');
  });

  it('activates Windows by enabling the scheduled task before running it', () => {
    const plan = planServiceAction({
      backend: 'schtasks-user',
      action: 'activate',
      label: 'happier-server',
      taskName: 'Happier\\happier-server',
      definitionPath: 'C:\\Users\\alice\\.happier\\services\\happier-server.ps1',
    });

    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]).toMatchObject({ cmd: 'powershell.exe' });
    expect(plan.commands[0]?.args.at(-1)).toContain('Enable-ScheduledTask');
    expect(plan.commands[1]).toEqual({ cmd: 'schtasks', args: ['/Run', '/TN', 'Happier\\happier-server'] });
  });
});
