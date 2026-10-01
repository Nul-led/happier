import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { planDaemonServiceInstall, type DaemonServicePlatform } from './plan';
import { resolveDaemonServiceIrohRelayConfig } from './resolveDaemonServiceIrohRelayConfig';
import { resolveDaemonServiceHomeCarrierPolicy } from './resolveDaemonServiceHomeCarrierPolicy';

function planFor(platform: DaemonServicePlatform, processEnv: NodeJS.ProcessEnv) {
  return planDaemonServiceInstall({
    platform,
    mode: 'user',
    channel: 'stable',
    targetMode: 'default-following',
    instanceId: 'default',
    userHomeDir: platform === 'win32' ? 'C:\\Users\\test' : '/home/test',
    happierHomeDir: platform === 'win32' ? 'C:\\Users\\test\\.happier' : '/home/test/.happier',
    serverUrl: 'https://api.happier.dev',
    webappUrl: 'https://app.happier.dev',
    publicServerUrl: 'https://api.happier.dev',
    nodePath: platform === 'win32' ? 'C:\\bin\\happier.exe' : '/usr/bin/happier',
    entryPath: '',
    irohRelayConfig: resolveDaemonServiceIrohRelayConfig({ processEnv }),
    homeCarrierEligibility: resolveDaemonServiceHomeCarrierPolicy({ processEnv }),
  });
}

describe('daemon service carrier environment', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'persists Standard-only application carrier mode in the %s service definition',
    (platform) => {
      const contents = planFor(platform, { HAPPIER_HOME_CARRIER_POLICY: ' STANDARD_ONLY ' }).files[0]?.content ?? '';
      expect(contents).toContain('HAPPIER_HOME_CARRIER_POLICY');
      expect(contents).toContain('standard_only');
    },
  );

  it('retains an installed Standard-only mode without an override', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'happier-daemon-carrier-service-'));
    try {
      const installedPlan = planFor('linux', { HAPPIER_HOME_CARRIER_POLICY: 'standard_only' });
      const installedPath = join(tempDir, 'happier-daemon.default.service');
      writeFileSync(installedPath, installedPlan.files[0]?.content ?? '', 'utf8');

      expect(resolveDaemonServiceHomeCarrierPolicy({
        processEnv: {},
        installedService: { platform: 'linux', path: installedPath },
      })).toBe('standard_only');
      expect(resolveDaemonServiceHomeCarrierPolicy({
        processEnv: { HAPPIER_HOME_CARRIER_POLICY: 'automatic' },
        installedService: { platform: 'linux', path: installedPath },
      })).toBe('automatic');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid explicit application carrier mode', () => {
    expect(() => planFor('linux', { HAPPIER_HOME_CARRIER_POLICY: 'disabled' }))
      .toThrow('HAPPIER_HOME_CARRIER_POLICY');
  });

  it.each(['darwin', 'linux', 'win32'] as const)(
    'persists the same normalized automatic relay configuration on %s',
    (platform) => {
      const plan = planFor(platform, {
        HAPPIER_IROH_RELAY_POLICY: ' AUTOMATIC ',
        HAPPIER_IROH_RELAY_URLS: 'https://relay-b.example, https://relay-a.example',
      });
      const contents = plan.files[0]?.content ?? '';

      expect(contents).toContain('HAPPIER_IROH_RELAY_POLICY');
      expect(contents).toContain('automatic');
      expect(contents).toContain('HAPPIER_IROH_RELAY_URLS');
      expect(contents).toContain('https://relay-a.example,https://relay-b.example');
    },
  );

  it('preserves missing configuration as missing', () => {
    const contents = planFor('linux', {}).files[0]?.content ?? '';

    expect(contents).not.toContain('HAPPIER_IROH_RELAY_POLICY');
    expect(contents).not.toContain('HAPPIER_IROH_RELAY_URLS');
    expect(contents).not.toContain('HAPPIER_HOME_CARRIER_POLICY');
  });

  it('persists disabled without relay URLs', () => {
    const contents = planFor('linux', {
      HAPPIER_IROH_RELAY_POLICY: 'disabled',
    }).files[0]?.content ?? '';

    expect(contents).toContain('Environment=HAPPIER_IROH_RELAY_POLICY=disabled');
    expect(contents).not.toContain('HAPPIER_IROH_RELAY_URLS');
  });

  it('reuses canonical validation for invalid policy and disabled-with-URLs combinations', () => {
    expect(() => resolveDaemonServiceIrohRelayConfig({
      processEnv: { HAPPIER_IROH_RELAY_POLICY: 'relay-only' },
    })).toThrow(/must be "automatic" or "disabled"/u);

    expect(() => resolveDaemonServiceIrohRelayConfig({
      processEnv: {
        HAPPIER_IROH_RELAY_POLICY: 'disabled',
        HAPPIER_IROH_RELAY_URLS: 'https://relay.example',
      },
    })).toThrow(/cannot be combined/u);
  });

  it('retains the installed normalized values when an update has no relay override', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'happier-daemon-iroh-service-'));
    try {
      const installedPlan = planFor('linux', {
        HAPPIER_IROH_RELAY_POLICY: 'automatic',
        HAPPIER_IROH_RELAY_URLS: 'https://relay.example',
      });
      const installedPath = join(tempDir, 'happier-daemon.default.service');
      writeFileSync(installedPath, installedPlan.files[0]?.content ?? '', 'utf8');

      const retained = resolveDaemonServiceIrohRelayConfig({
        processEnv: {},
        installedService: { platform: 'linux', path: installedPath },
      });

      expect(retained).toEqual({
        relayPolicy: 'automatic',
        relayUrls: ['https://relay.example'],
        explicitlyConfigured: true,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
