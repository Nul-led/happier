import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  resolveRelayRuntimeDefaults,
  writePersonalHomeServerArtifactCapability,
} from '@happier-dev/cli-common/firstPartyRuntime';
import { executeSystemTask } from '@happier-dev/cli-common/systemTasks';
import type { SystemTaskResult } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { createHsetupSystemTaskRegistry } from './registry.js';
import { installOrUpdateRelayRuntimeDefault } from './relayRuntimeTasks.js';

/** Surfaces the exact typed task failure instead of an opaque ok:true assertion. */
function expectTaskOk(result: SystemTaskResult, label: string): void {
  expect(
    result.ok,
    `${label} failed typed: ${result.ok ? 'ok' : `${result.error.code}: ${result.error.message}`}`,
  ).toBe(true);
}

describe('bootstrap relay-runtime registry composition', () => {
  it('rejects a capability-less Personal Home artifact before the Desktop task mutates runtime state', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'hsetup-registry-personal-home-admission-'));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = homeDir;
      process.env.USERPROFILE = homeDir;
      const payloadRoot = join(homeDir, 'payload');
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      mkdirSync(payloadRoot, { recursive: true });
      writeFileSync(serverBinaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const canonicalServerUrl = 'http://127.0.0.1:43123';
      const registry = createHsetupSystemTaskRegistry({
        relayRuntime: {
          installOrUpdate: async (params) => await installOrUpdateRelayRuntimeDefault(params, {
            runLocalServiceCommands: false,
            skipLocalHealthCheck: true,
          }),
          checkHealth: async () => false,
        },
      });

      const result = await executeSystemTask({
        spec: {
          protocolVersion: 1,
          kind: 'relay.runtime.installOrUpdate.v1',
          params: {
            target: { kind: 'local' },
            channel: 'stable',
            mode: 'user',
            selfHostRelayBinaryOverride: serverBinaryPath,
            purpose: { kind: 'personal-home', canonicalServerUrl },
            env: {
              HAPPIER_SERVER_HOST: '127.0.0.1',
              PORT: '43123',
              HAPPIER_CANONICAL_SERVER_URL: canonicalServerUrl,
              HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
              HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
              AUTH_ANONYMOUS_SIGNUP_ENABLED: '1',
            },
          },
        },
        taskId: 'task_registry_personal_home_admission',
        registry,
        now: () => 1700000000000,
        emitEvent: () => undefined,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'personal_home_artifact_update_required' },
      });
      const defaults = resolveRelayRuntimeDefaults({ platform: process.platform, mode: 'user', channel: 'stable', homeDir });
      expect(existsSync(join(defaults.installRoot, 'self-host-state.json'))).toBe(false);
      expect(existsSync(join(defaults.installRoot, 'bin', 'happier-server'))).toBe(false);
      expect(existsSync(defaults.configDir)).toBe(false);
      expect(existsSync(join(defaults.dataDir, 'pglite'))).toBe(false);
      expect(existsSync(join(defaults.dataDir, 'migrations'))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('keeps a closed Personal Home signup policy through install/update and restart when the caller requests re-enabling it', { timeout: 120_000 }, async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'hsetup-registry-personal-home-install-'));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousPath = process.env.PATH;
    const previousSystemctlLog = process.env.HAPPIER_TEST_SYSTEMCTL_LOG;
    const previousPlatform = process.platform;
    let readinessIdentity: string | null = null;
    let serviceDefinitionPath: string | null = null;
    let receiptPort: number | null = null;
    const healthServer = createServer((_request, response) => {
      if (readinessIdentity && serviceDefinitionPath && receiptPort !== null) {
        const definition = readFileSync(serviceDefinitionPath, 'utf8');
        const receiptPath = definition.match(/^Environment=HAPPIER_SERVER_STARTUP_RECEIPT_PATH=(.+)$/mu)?.[1]?.replace(/^"|"$/gu, '');
        const nonce = definition.match(/^Environment=HAPPIER_SERVER_STARTUP_RECEIPT_NONCE=(.+)$/mu)?.[1]?.replace(/^"|"$/gu, '');
        if (receiptPath && nonce) {
          mkdirSync(dirname(receiptPath), { recursive: true });
          writeFileSync(receiptPath, JSON.stringify({
            nonce,
            pid: process.pid,
            host: '127.0.0.1',
            port: receiptPort,
            personalHomeReadiness: {
              authenticated: true,
              homeServerIdentityId: readinessIdentity,
              accountCount: 1,
              sessionCount: 0,
            },
          }));
        }
      }
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
      receiptPort = port;
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
      const migrationDir = join(payloadRoot, 'prisma', 'sqlite', 'migrations', '20200101000000_init');
      mkdirSync(payloadRoot, { recursive: true });
      mkdirSync(migrationDir, { recursive: true });
      writeFileSync(serverBinaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      writeFileSync(join(migrationDir, 'migration.sql'), '-- fixture migration\n');
      chmodSync(serverBinaryPath, 0o755);
      await writePersonalHomeServerArtifactCapability(payloadRoot);

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
          // Lane 03 execution amendment A5: the stable loopback audience rides the canonical
          // URL owner; HAPPIER_PUBLIC_SERVER_URL is not a fixed Personal Home env key.
          HAPPIER_CANONICAL_SERVER_URL: canonicalServerUrl,
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
      expectTaskOk(installed, 'relay.runtime.installOrUpdate.v1');
      const envPath = join(defaults.configDir, 'server.env');
      const installedEnv = readFileSync(envPath, 'utf8');
      expect(installedEnv.match(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=0$/gmu) ?? []).toHaveLength(1);
      expect(installedEnv).not.toMatch(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=(?:1|true)$/gmu);
      // A5: the seeded legacy public-origin line equal to the canonical loopback audience is
      // retired by the canonical installer and never re-added for a loopback-only Home.
      expect(installedEnv).not.toMatch(/^HAPPIER_PUBLIC_SERVER_URL=/gmu);

      const identity = 'registry-proof-home';
      readinessIdentity = identity;
      serviceDefinitionPath = join(homeDir, '.config', 'systemd', 'user', 'happier-server.service');
      mkdirSync(defaults.dataDir, { recursive: true });
      const database = new DatabaseSync(join(defaults.dataDir, 'happier-server-light.sqlite'));
      database.exec('CREATE TABLE SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      database.exec('CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, checksum TEXT NOT NULL, finished_at TEXT, rolled_back_at TEXT)');
      database.prepare('INSERT INTO SimpleCache (key, value) VALUES (?, ?)').run('server.identity.v1', identity);
      database.prepare('INSERT INTO _prisma_migrations (migration_name, checksum, finished_at, rolled_back_at) VALUES (?, ?, ?, NULL)').run(
        '20200101000000_init',
        createHash('sha256').update('-- fixture migration\n').digest('hex'),
        '2026-09-08T00:00:00.000Z',
      );
      database.close();

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
      expectTaskOk(restarted, 'relay.runtime.restart.v1');
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
