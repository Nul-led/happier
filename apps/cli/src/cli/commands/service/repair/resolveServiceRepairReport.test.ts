import { describe, expect, it, vi } from 'vitest';

const {
  buildHappierRuntimeWarningsMock,
  discoverHappierInstallationsMock,
  discoverHappierServicesMock,
  listDaemonStatusesForAllKnownServersMock,
  readDaemonStatusSnapshotMock,
  readStatusMock,
  resolveBackgroundServiceRepairPlanForCurrentRuntimeMock,
} = vi.hoisted(() => ({
  buildHappierRuntimeWarningsMock: vi.fn((_params: unknown) => []),
  discoverHappierInstallationsMock: vi.fn(async (_params: unknown) => ({
    activeInvocation: null,
    installations: [],
  })),
  discoverHappierServicesMock: vi.fn(async (_params: unknown) => ({
    services: [],
  })),
  listDaemonStatusesForAllKnownServersMock: vi.fn(async () => [
    {
      serverId: 'cloud',
      name: 'Cloud',
      serverUrl: 'https://relay.example.test',
      comparableKey: 'https://relay.example.test',
      daemonStatePath: '/tmp/daemon-state.json',
      auth: {
        authenticated: true,
        credentialState: 'valid',
        needsAuth: false,
        machineRegistered: true,
        machineRegistrationState: 'server-confirmed',
        machineId: 'machine-1',
        accountId: 'account-1',
      },
      drift: {
        activeComparableKey: 'https://relay.example.test',
        matchesActiveRelay: true,
      },
      service: {
        installed: true,
        running: false,
      },
      daemon: {
        pid: null,
        httpPort: null,
        running: false,
        staleStateFile: false,
      },
    },
  ]),
  readDaemonStatusSnapshotMock: vi.fn(async () => null),
  readStatusMock: vi.fn(async (_params: unknown) => ({
    installed: false,
    baseUrl: null,
    service: { active: false },
    healthy: null,
    version: null,
    warnings: [],
  })),
  resolveBackgroundServiceRepairPlanForCurrentRuntimeMock: vi.fn(async (_params: unknown) => ({
    runtime: {
      platform: 'linux',
      channel: 'stable',
      targetMode: 'default-following',
      instanceId: 'cloud',
      uid: 1000,
      userHomeDir: '/home/test',
      happierHomeDir: '/home/test/.happier',
      serverUrl: 'https://relay.example.test',
      publicServerUrl: 'https://relay.example.test',
      webappUrl: 'https://app.example.test',
      nodePath: '/usr/bin/node',
      entryPath: '/opt/happier/index.mjs',
    },
    services: [],
    scannedModes: ['user'],
    plan: {
      currentReleaseChannel: 'stable',
      existingServices: [
        {
          name: 'Happier',
          label: 'happier-daemon.default',
          mode: 'user',
          releaseChannel: 'preview',
          targetMode: 'default-following',
          serverId: 'cloud',
          installed: true,
          path: '/home/test/.config/systemd/user/happier-daemon.default.service',
          platform: 'linux',
        },
      ],
      actions: [],
      manualWarnings: [],
    },
  })),
}));

vi.mock('@happier-dev/cli-common/happierRuntime', () => ({
  buildHappierRuntimeWarnings: (params: unknown) => buildHappierRuntimeWarningsMock(params),
  discoverHappierInstallations: (params: unknown) => discoverHappierInstallationsMock(params),
  discoverHappierServices: (params: unknown) => discoverHappierServicesMock(params),
}));

vi.mock('@happier-dev/cli-common/relayHost', () => ({
  createRelayHostEngine: () => ({
    readStatus: (params: unknown) => readStatusMock(params),
  }),
}));

vi.mock('@/daemon/multiDaemon', () => ({
  listDaemonStatusesForAllKnownServers: () => listDaemonStatusesForAllKnownServersMock(),
}));

vi.mock('@/daemon/statusSnapshot', () => ({
  readDaemonStatusSnapshot: () => readDaemonStatusSnapshotMock(),
}));

vi.mock('@/diagnostics/backgroundServiceRepair/resolveBackgroundServiceRepairPlanForCurrentRuntime', () => ({
  resolveBackgroundServiceRepairPlanForCurrentRuntime: (params: unknown) =>
    resolveBackgroundServiceRepairPlanForCurrentRuntimeMock(params),
}));

import { resolveServiceRepairReport } from './resolveServiceRepairReport';

describe('resolveServiceRepairReport', () => {
  it('uses repair-plan service release channels when building active stack findings', async () => {
    const resolution = await resolveServiceRepairReport({
      preferredMode: 'user',
      includeAllModes: true,
      systemUser: '',
    });

    expect(resolution.report.stacks).toEqual([
      expect.objectContaining({
        id: 'cloud',
        releaseChannel: 'preview',
        active: true,
      }),
    ]);
    expect(resolution.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'channel_switch_recommended',
        actions: [
          {
            kind: 'switch-release-channel',
            releaseChannel: 'preview',
            command: 'happier self release-channel use preview',
          },
        ],
      }),
    ]));
  });

  it('reports expired auth when active Relay credentials are rejected', async () => {
    listDaemonStatusesForAllKnownServersMock.mockResolvedValueOnce([
      {
        serverId: 'cloud',
        name: 'Cloud',
        serverUrl: 'https://relay.example.test',
        comparableKey: 'https://relay.example.test',
        daemonStatePath: '/tmp/daemon-state.json',
        auth: {
          authenticated: false,
          credentialState: 'invalid',
          needsAuth: true,
          machineRegistered: true,
          machineRegistrationState: 'server-confirmed',
          machineId: 'machine-1',
          accountId: 'account-1',
        },
        drift: {
          activeComparableKey: 'https://relay.example.test',
          matchesActiveRelay: true,
        },
        service: { installed: true, running: false },
        daemon: { pid: null, httpPort: null, running: false, staleStateFile: false },
      },
    ]);

    const resolution = await resolveServiceRepairReport({
      preferredMode: 'user',
      includeAllModes: true,
      systemUser: '',
    });

    expect(resolution.report.authProfiles).toEqual([
      expect.objectContaining({
        id: 'cloud',
        active: true,
        authenticated: false,
        authState: 'expired',
      }),
    ]);
    expect(resolution.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'auth_expired_for_active_profile',
      }),
    ]));
  });

  it('preserves inconclusive validation without reporting stored credentials as missing', async () => {
    listDaemonStatusesForAllKnownServersMock.mockResolvedValueOnce([
      {
        serverId: 'cloud',
        name: 'Cloud',
        serverUrl: 'https://relay.example.test',
        comparableKey: 'https://relay.example.test',
        daemonStatePath: '/tmp/daemon-state.json',
        auth: {
          authenticated: false,
          credentialState: 'unknown',
          needsAuth: true,
          machineRegistered: true,
          machineRegistrationState: 'server-confirmed',
          machineId: 'machine-1',
          accountId: 'account-1',
        },
        drift: {
          activeComparableKey: 'https://relay.example.test',
          matchesActiveRelay: true,
        },
        service: { installed: true, running: false },
        daemon: { pid: null, httpPort: null, running: false, staleStateFile: false },
      },
    ]);

    const resolution = await resolveServiceRepairReport({
      preferredMode: 'user',
      includeAllModes: true,
      systemUser: '',
    });

    expect(resolution.report.authProfiles).toEqual([
      expect.objectContaining({
        id: 'cloud',
        authenticated: false,
        authState: 'unknown',
      }),
    ]);
    expect(resolution.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'auth_missing_for_profile' }),
    ]));
  });
});
