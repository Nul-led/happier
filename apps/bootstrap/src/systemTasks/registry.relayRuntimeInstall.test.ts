import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveRelayRuntimeDefaults } from '@happier-dev/cli-common/firstPartyRuntime';
import { executeSystemTask } from '@happier-dev/cli-common/systemTasks';
import { describe, expect, it } from 'vitest';

import { createHsetupSystemTaskRegistry } from './registry.js';
import { installOrUpdateRelayRuntimeDefault } from './relayRuntimeTasks.js';

describe('bootstrap relay-runtime registry composition', () => {
  it('keeps a closed Personal Home signup policy through install/update and restart when the caller requests re-enabling it', { timeout: 120_000 }, async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'hsetup-registry-personal-home-install-'));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousPath = process.env.PATH;
    const previousSystemctlLog = process.env.HAPPIER_TEST_SYSTEMCTL_LOG;
    const previousPlatform = process.platform;
    const healthServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', version: 'registry-proof' }));
    });
    try {
      process.env.HOME = homeDir;
      process.env.USERPROFILE = homeDir;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      // Service-manager execution is the genuine external process boundary. Keep the registry,
      // task kind, RelayHostEngine, local installer, env writer, and persisted-purpose reader real.
      const boundaryBinDir = join(homeDir, 'boundary-bin');
      const systemctlLogPath = join(homeDir, 'systemctl.log');
      mkdirSync(boundaryBinDir, { recursive: true });
      const systemctlPath = join(boundaryBinDir, 'systemctl');
      writeFileSync(systemctlPath, [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$HAPPIER_TEST_SYSTEMCTL_LOG"',
        'printf "LoadState=not-found\\nActiveState=inactive\\nUnitFileState=disabled\\n"',
        'exit 0',
        '',
      ].join('\n'), { mode: 0o755 });
      chmodSync(systemctlPath, 0o755);
      process.env.PATH = `${boundaryBinDir}:${previousPath ?? ''}`;
      process.env.HAPPIER_TEST_SYSTEMCTL_LOG = systemctlLogPath;

      await new Promise<void>((resolve, reject) => {
        healthServer.once('error', reject);
        healthServer.listen(0, '127.0.0.1', resolve);
      });
      const address = healthServer.address();
      if (!address || typeof address === 'string') throw new Error('Failed to reserve registry proof port');
      const port = address.port;
      await new Promise<void>((resolve, reject) => healthServer.close((error) => error ? reject(error) : resolve()));
      const canonicalServerUrl = `http://127.0.0.1:${port}`;
      const defaults = resolveRelayRuntimeDefaults({
        platform: 'linux',
        mode: 'user',
        channel: 'stable',
        homeDir,
      });
      mkdirSync(defaults.configDir, { recursive: true });
      writeFileSync(join(defaults.configDir, 'server.env'), [
        'HAPPIER_SERVER_HOST=127.0.0.1',
        `PORT=${port}`,
        `HAPPIER_PUBLIC_SERVER_URL=${canonicalServerUrl}`,
        'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
        'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        '',
      ].join('\n'));

      const payloadRoot = join(homeDir, 'payload');
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      mkdirSync(payloadRoot, { recursive: true });
      writeFileSync(serverBinaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      chmodSync(serverBinaryPath, 0o755);

      const registry = createHsetupSystemTaskRegistry({
        relayRuntime: {
          // Only service activation and the live health probe are suppressed. This production
          // adapter still constructs RelayHostEngine and reaches installOrUpdateRelayRuntimeLocal.
          installOrUpdate: async (params) => await installOrUpdateRelayRuntimeDefault(params, {
            runLocalServiceCommands: false,
            skipLocalHealthCheck: true,
          }),
          checkHealth: async () => false,
        },
      });
      const taskParams = {
        target: { kind: 'local' as const },
        channel: 'stable' as const,
        mode: 'user' as const,
        selfHostRelayBinaryOverride: serverBinaryPath,
        purpose: { kind: 'personal-home' as const, canonicalServerUrl },
        env: {
          HAPPIER_SERVER_HOST: '127.0.0.1',
          PORT: String(port),
          HAPPIER_PUBLIC_SERVER_URL: canonicalServerUrl,
          HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
          HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
          AUTH_ANONYMOUS_SIGNUP_ENABLED: '1',
        },
      };

      const installed = await executeSystemTask({
        spec: {
          protocolVersion: 1,
          kind: 'relay.runtime.installOrUpdate.v1',
          params: taskParams,
        },
        taskId: 'task_registry_personal_home_install',
        registry,
        now: () => 1700000000000,
        emitEvent: () => undefined,
      });
      expect(installed.ok).toBe(true);
      const envPath = join(defaults.configDir, 'server.env');
      const installedEnv = readFileSync(envPath, 'utf8');
      expect(installedEnv.match(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=0$/gmu) ?? []).toHaveLength(1);
      expect(installedEnv).not.toMatch(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=(?:1|true)$/gmu);

      await new Promise<void>((resolve, reject) => {
        healthServer.once('error', reject);
        healthServer.listen(port, '127.0.0.1', resolve);
      });

      const restarted = await executeSystemTask({
        spec: {
          protocolVersion: 1,
          kind: 'relay.runtime.restart.v1',
          params: taskParams,
        },
        taskId: 'task_registry_personal_home_restart',
        registry,
        now: () => 1700000000001,
        emitEvent: () => undefined,
      });
      expect(restarted.ok).toBe(true);
      expect(readFileSync(systemctlLogPath, 'utf8')).toMatch(/--user restart happier-server\.service/u);
      const restartedEnv = readFileSync(envPath, 'utf8');
      expect(restartedEnv.match(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=0$/gmu) ?? []).toHaveLength(1);
      expect(restartedEnv).not.toMatch(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=(?:1|true)$/gmu);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousSystemctlLog === undefined) delete process.env.HAPPIER_TEST_SYSTEMCTL_LOG;
      else process.env.HAPPIER_TEST_SYSTEMCTL_LOG = previousSystemctlLog;
      Object.defineProperty(process, 'platform', { value: previousPlatform });
      if (healthServer.listening) {
        await new Promise<void>((resolve) => healthServer.close(() => resolve()));
      }
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
