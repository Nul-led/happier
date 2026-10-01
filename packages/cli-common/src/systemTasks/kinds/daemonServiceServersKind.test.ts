import { describe, expect, it } from 'vitest';

import type { HappierService } from '../../happierRuntime/types.js';
import type { DaemonServiceStatusSnapshot } from './daemonServiceKinds.js';
import { readDaemonServiceInventory, type DaemonServiceServersKindDeps } from './daemonServiceServersKind.js';

const HOME_DIR = '/home/u/.happier';

function daemonService(overrides: Partial<HappierService>): HappierService {
  return {
    id: 'svc',
    serviceType: 'daemon',
    platform: 'linux',
    backend: 'systemd-user',
    label: 'happier-daemon',
    targetMode: 'pinned',
    verification: 'verified',
    ring: 'stable',
    instanceId: null,
    scope: 'user',
    definitionPath: '/home/u/.config/systemd/user/happier.service',
    executablePath: null,
    happierHomeDir: HOME_DIR,
    installed: true,
    running: true,
    ...overrides,
  } as HappierService;
}

function status(overrides: Partial<DaemonServiceStatusSnapshot>): DaemonServiceStatusSnapshot {
  return {
    serviceInstalled: true,
    daemonRunning: true,
    needsAuth: false,
    machineId: 'machine-1',
    daemonServerUrl: null,
    daemonComparableKey: null,
    daemonAccountId: 'acct_1',
    daemonMachineRegistered: true,
    daemonAccountLabel: null,
    cliUpdate: null,
    ...overrides,
  };
}

function run(deps: Partial<DaemonServiceServersKindDeps>) {
  const inventoryDeps: DaemonServiceServersKindDeps = {
    resolveReleaseRing: () => 'stable',
    hasLocalCli: () => true,
    happierHomeDir: () => HOME_DIR,
    readServices: async () => [],
    readStatus: async () => status({}),
    ...deps,
  };
  return readDaemonServiceInventory(inventoryDeps, {
    params: { target: { kind: 'local' }, channel: 'stable' },
    emit: () => {},
    prompt: async () => null,
  });
}

describe('status inventory — every server this computer serves (R15 d)', () => {
  it('projects the Personal Home public identity instead of its local transport URL', async () => {
    const publicUrl = 'https://home.example.test';
    const result = await run({
      readServices: async () => [daemonService({ serverUrl: 'http://127.0.0.1:3005', publicServerUrl: publicUrl, managedBy: 'desktop' })],
      readStatus: async () => status({ daemonServerUrl: publicUrl }),
    });
    expect(result.serviceRows).toMatchObject([{ relayUrl: publicUrl, state: 'connected' }]);
  });

  it('does not offer Start when the executor would reject installation or authentication', async () => {
    for (const facts of [{ serviceInstalled: false }, { needsAuth: true }]) {
      const result = await run({
        readServices: async () => [daemonService({ serverUrl: 'https://home.example.test', managedBy: 'desktop' })],
        readStatus: async () => status({ daemonRunning: false, daemonServerUrl: 'https://home.example.test', ...facts }),
      });
      expect(result.serviceRows[0]?.actions).toEqual([]);
    }
  });

  it('keeps malformed relay inventory incomplete without projecting an actionable URL', async () => {
    const result = await run({
      readServices: async () => [daemonService({ serverUrl: 'not a relay', managedBy: 'desktop' })],
      readStatus: async () => status({ daemonServerUrl: 'not a relay' }),
    });
    expect(result.servers).toHaveLength(1);
    expect(result.serviceRows).toEqual([]);
    expect(result.serviceRowsComplete).toBe(false);
  });
  it('lists each daemon service of this home and ring with its own daemon status, addressed to its own server', async () => {
    const reads: Array<string | null> = [];
    const result = await run({
      readServices: async () => [
        daemonService({ label: 'happier-daemon.default', targetMode: 'default-following', instanceId: null }),
        daemonService({
          label: 'happier-daemon.company',
          instanceId: 'company',
          serverUrl: 'https://company.example.test',
          publicServerUrl: 'https://company.example.test',
          managedBy: 'desktop',
        }),
        // Another Happier home and another ring are not this computer's services for this app.
        daemonService({ label: 'happier-daemon.other-home', instanceId: 'x', happierHomeDir: '/other/.happier' }),
        daemonService({ label: 'happier-daemon.preview.y', instanceId: 'y', ring: 'preview' }),
      ],
      readStatus: async (target) => {
        reads.push(target.relayUrl ?? null);
        return target.relayUrl
          ? status({ daemonServerUrl: 'https://company.example.test', daemonRunning: false })
          : status({ daemonServerUrl: 'https://api.happier.dev' });
      },
    });

    expect(reads.sort()).toEqual([null, 'https://company.example.test'].sort());
    expect(result.servers).toEqual([
      expect.objectContaining({
        label: 'happier-daemon.company',
        targetMode: 'pinned',
        managedBy: 'desktop',
        serverUrl: 'https://company.example.test',
        status: expect.objectContaining({ daemonRunning: false }),
      }),
      expect.objectContaining({
        label: 'happier-daemon.default',
        targetMode: 'default-following',
        managedBy: null,
        serverUrl: 'https://api.happier.dev',
      }),
    ]);
  });

  it('keeps an entry whose status cannot be read, as unreadable, without dropping the others', async () => {
    const result = await run({
      readServices: async () => [
        daemonService({ label: 'happier-daemon.a', instanceId: 'a', serverUrl: 'https://a.example.test' }),
        daemonService({ label: 'happier-daemon.b', instanceId: 'b', serverUrl: 'https://b.example.test' }),
      ],
      readStatus: async (target) => {
        if (target.relayUrl === 'https://a.example.test') throw new Error('status failed');
        return status({ daemonServerUrl: 'https://b.example.test' });
      },
    });
    expect(result.servers.map((entry) => [entry.label, entry.status === null])).toEqual([
      ['happier-daemon.a', true],
      ['happier-daemon.b', false],
    ]);
    expect(result.servers[0]?.serverUrl).toBe('https://a.example.test');
  });

  it('retains both services but projects only the pin when it serves the default-following relay', async () => {
    const result = await run({
      readServices: async () => [
        daemonService({ label: 'happier-daemon.default', targetMode: 'default-following', instanceId: null }),
        daemonService({ label: 'happier-daemon.company', instanceId: 'company', serverUrl: 'https://company.example.test/' }),
      ],
      readStatus: async () => status({ daemonServerUrl: 'https://company.example.test' }),
    });
    expect(result.servers.map((entry) => [entry.label, entry.serving])).toEqual([
      ['happier-daemon.company', true],
      ['happier-daemon.default', false],
    ]);
    expect(result.serviceRows).toEqual([expect.objectContaining({
      relayUrl: 'https://company.example.test/', serviceTargetMode: 'pinned', appManaged: false, actions: [],
    })]);
  });

  it('never acquires a CLI: with no local CLI there is nothing to list', async () => {
    let read = false;
    const result = await run({
      hasLocalCli: () => false,
      readServices: async () => { read = true; return [daemonService({ instanceId: 'a' })]; },
    });
    expect(result).toEqual({ servers: [], serviceRows: [], serviceRowsComplete: true });
    expect(read).toBe(false);
  });

  it('projects truthful state and permissions while retaining an unreadable default without a URL', async () => {
    const result = await run({
      readServices: async () => [
        daemonService({ label: 'default', targetMode: 'default-following' }),
        daemonService({ label: 'offline', instanceId: 'offline', serverUrl: 'https://offline.test', managedBy: 'desktop' }),
        daemonService({ label: 'connected', instanceId: 'connected', serverUrl: 'https://connected.test', managedBy: 'desktop' }),
        daemonService({ label: 'drift', instanceId: 'drift', serverUrl: 'https://expected.test', managedBy: 'desktop' }),
        daemonService({ label: 'candidate', instanceId: 'candidate', serverUrl: 'https://candidate.test', verification: 'candidate', managedBy: 'desktop' }),
        daemonService({ label: 'unknown', instanceId: 'unknown', serverUrl: 'https://unknown.test', managedBy: 'desktop' }),
        daemonService({ label: 'unreported', instanceId: 'unreported', serverUrl: 'https://unreported.test', managedBy: 'desktop' }),
      ],
      readStatus: async (target) => {
        if (!target.relayUrl || target.relayUrl === 'https://unknown.test') throw new Error('unreadable');
        if (target.relayUrl === 'https://unreported.test') return status({ daemonServerUrl: null });
        return status({ daemonServerUrl: target.relayUrl === 'https://expected.test' ? 'https://wrong.test' : target.relayUrl, daemonRunning: target.relayUrl !== 'https://offline.test', daemonMachineRegistered: false });
      },
    });
    expect(result.servers.find((entry) => entry.label === 'default')).toMatchObject({ serverUrl: null, status: null, serving: false });
    expect(result.serviceRows).toEqual([
      { relayUrl: 'https://candidate.test', state: 'needs_attention', appManaged: false, serviceTargetMode: 'pinned', actions: [] },
      { relayUrl: 'https://connected.test', state: 'connected', appManaged: true, serviceTargetMode: 'pinned', actions: ['restart', 'stop'] },
      { relayUrl: 'https://expected.test', state: 'needs_attention', appManaged: true, serviceTargetMode: 'pinned', actions: ['restart', 'stop'] },
      { relayUrl: 'https://offline.test', state: 'offline', appManaged: true, serviceTargetMode: 'pinned', actions: ['start'] },
      { relayUrl: 'https://unknown.test', state: 'needs_attention', appManaged: true, serviceTargetMode: 'pinned', actions: [] },
      { relayUrl: 'https://unreported.test', state: 'needs_attention', appManaged: true, serviceTargetMode: 'pinned', actions: ['restart', 'stop'] },
    ]);
    expect(result.serviceRowsComplete).toBe(false);
  });
});
