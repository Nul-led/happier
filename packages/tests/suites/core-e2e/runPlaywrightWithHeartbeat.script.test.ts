import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { repoRootDir } from '../../src/testkit/paths';

import {
  createPlaywrightSpawnOptions,
  parseHeartbeatArgs,
  resolveSignalExitCode,
} from '../../scripts/runPlaywrightWithHeartbeat.shared.mjs';

const execFileAsync = promisify(execFile);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function createCapturingYarnBin(binDir: string, capturePath: string): Promise<void> {
  const scriptPath = join(binDir, 'capture-yarn.cjs');
  await writeFile(
    scriptPath,
    [
      "'use strict';",
      "const { writeFileSync } = require('node:fs');",
      `writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }), 'utf8');`,
      '',
    ].join('\n'),
    'utf8',
  );

  const commandPath = join(binDir, process.platform === 'win32' ? 'yarn.cmd' : 'yarn');
  if (process.platform === 'win32') {
    await writeFile(commandPath, ['@echo off', `node "${scriptPath}" %*`, ''].join('\r\n'), 'utf8');
    return;
  }

  await writeFile(commandPath, ['#!/usr/bin/env node', "require('./capture-yarn.cjs');", ''].join('\n'), 'utf8');
  await chmod(commandPath, 0o755);
}

async function captureVitestHeartbeatInvocation(args: readonly string[]): Promise<{ cwd: string; argv: string[] }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'happier-vitest-heartbeat-'));
  try {
    const binDir = join(tempDir, 'bin');
    const capturePath = join(tempDir, 'capture.json');
    await mkdir(binDir, { recursive: true });
    await createCapturingYarnBin(binDir, capturePath);

    await execFileAsync(
      process.execPath,
      [resolve(repoRootDir(), 'packages/tests/scripts/run-vitest-with-heartbeat.mjs'), ...args],
      {
        cwd: repoRootDir(),
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          HAPPIER_TEST_HEARTBEAT_MS: '1000000',
        },
        timeout: 10_000,
      },
    );

    return JSON.parse(await readFile(capturePath, 'utf8')) as { cwd: string; argv: string[] };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe('runPlaywrightWithHeartbeat helpers', () => {
  it('supports both config flag forms while preserving passthrough args', () => {
    expect(parseHeartbeatArgs(['node', 'script', '--config', 'playwright.ui.config.mjs', '--grep', 'tmux'])).toEqual({
      config: 'playwright.ui.config.mjs',
      passThrough: ['--grep', 'tmux'],
    });
    expect(parseHeartbeatArgs(['node', 'script', '--config=playwright.ui.config.mjs', '--reporter=line'])).toEqual({
      config: 'playwright.ui.config.mjs',
      passThrough: ['--reporter=line'],
    });
  });

  it('uses detached child processes for playwright runs on non-Windows platforms', () => {
    expect(createPlaywrightSpawnOptions({ TEST_FLAG: '1' })).toMatchObject({
      detached: process.platform !== 'win32',
      stdio: 'inherit',
      env: expect.objectContaining({
        PLAYWRIGHT_HTML_OPEN: 'never',
        TEST_FLAG: '1',
      }),
    });
  });

  it('does not inject a UI web export namespace when one is not provided', () => {
    const first = createPlaywrightSpawnOptions({ TEST_FLAG: '1' });
    const second = createPlaywrightSpawnOptions({ TEST_FLAG: '1' });

    expect(first.env).toEqual(expect.objectContaining({
      TEST_FLAG: '1',
    }));
    expect(second.env).toEqual(expect.objectContaining({
      TEST_FLAG: '1',
    }));
    expect(first.env).not.toHaveProperty('HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE');
    expect(second.env).not.toHaveProperty('HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE');
  });

  it('preserves an explicit UI web export namespace', () => {
    const options = createPlaywrightSpawnOptions({
      TEST_FLAG: '1',
      HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'uiweb-explicit',
    });
    expect(options.env.HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE).toBe('uiweb-explicit');
  });

  it('wires playwright artifacts and HTML report output into the shared namespace', async () => {
    vi.stubEnv('CI', '1');
    vi.stubEnv('HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE', 'uiweb-explicit');

    const { default: config } = await import('../../playwright.ui.config.mjs');
    const expectedRootDir = resolve(repoRootDir(), '.project', 'logs', 'e2e', 'ui-playwright', 'uiweb-explicit');
    const expectedOutputDir = resolve(expectedRootDir, 'test-results');

    expect(config.outputDir).toBe(expectedOutputDir);

    const reporter = Array.isArray(config.reporter) ? config.reporter : [];
    const htmlReporter = reporter.find((entry: unknown) => Array.isArray(entry) && entry[0] === 'html');
    expect(htmlReporter).toEqual([
      'html',
      expect.objectContaining({
        open: 'never',
        outputFolder: resolve(expectedRootDir, 'html-report'),
      }),
    ]);
  });

  it('maps signals to conventional exit codes', () => {
    expect(resolveSignalExitCode('SIGINT')).toBe(130);
    expect(resolveSignalExitCode('SIGTERM')).toBe(143);
    expect(resolveSignalExitCode(null)).toBe(1);
  });

  it('runs the Vitest heartbeat child from the tests workspace when invoked at repo root', async () => {
    const capture = await captureVitestHeartbeatInvocation([
      '--config',
      'vitest.core.slow.config.ts',
      'suites/core-e2e/voice.agent.daemon.rpc.feat.voice.agent.slow.e2e.test.ts',
      '-t',
      'welcomedEpoch',
    ]);

    expect(capture.cwd).toBe(resolve(repoRootDir(), 'packages/tests'));
    expect(capture.argv).toEqual([
      '-s',
      'vitest',
      'run',
      '--no-file-parallelism',
      '-c',
      'vitest.core.slow.config.ts',
      'suites/core-e2e/voice.agent.daemon.rpc.feat.voice.agent.slow.e2e.test.ts',
      '-t',
      'welcomedEpoch',
    ]);
  });

  it('normalizes package-prefixed Vitest heartbeat paths before spawning the child', async () => {
    const capture = await captureVitestHeartbeatInvocation([
      '--config',
      'packages/tests/vitest.core.slow.config.ts',
      'packages/tests/suites/core-e2e/voice.agent.daemon.rpc.feat.voice.agent.slow.e2e.test.ts',
      '-t',
      'welcomedEpoch',
    ]);

    expect(capture.argv).toEqual([
      '-s',
      'vitest',
      'run',
      '--no-file-parallelism',
      '-c',
      'vitest.core.slow.config.ts',
      'suites/core-e2e/voice.agent.daemon.rpc.feat.voice.agent.slow.e2e.test.ts',
      '-t',
      'welcomedEpoch',
    ]);
  });

  it('sweeps stale lease-owned processes before and after the wrapped child run', async () => {
    const events: string[] = [];
    const sweepStaleProcessOwnershipLeases = vi.fn(async () => {
      events.push('sweep');
    });
    const runManagedChildCommand = vi.fn(async () => {
      events.push('run');
      return {
        child: { pid: 12345 },
        ok: true,
        code: 0,
        signal: null,
        timedOut: false,
      };
    });

    vi.doMock('../../../../scripts/testing/process/managedChildLifecycle.mjs', () => ({
      installParentDeathCleanupWatchdog: () => () => {},
      resolveSignalExitCode: (signal: string | null) => (signal === 'SIGINT' ? 130 : 1),
      runManagedChildCommand,
    }));
    vi.doMock('../../scripts/sweepProcessOwnershipLeases.mjs', () => ({
      sweepStaleProcessOwnershipLeases,
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? ''}`);
    }) as never);

    const { runHeartbeatWrappedCommand } = await import('../../scripts/runPlaywrightWithHeartbeat.shared.mjs');

    await expect(runHeartbeatWrappedCommand({
      command: 'yarn',
      args: ['-s', 'playwright', 'test'],
      config: 'playwright.ui.config.mjs',
      toolName: 'playwright',
      spawnOptions: createPlaywrightSpawnOptions({ CI: '1' }),
      resolveExitCode: () => 0,
    })).rejects.toThrow('process.exit:0');

    expect(events).toEqual(['sweep', 'run', 'sweep']);

    void logSpy;
    void errorSpy;
    void exitSpy;
  });

  it('writes a secret-free timeout artifact and exits with code 124', async () => {
    vi.resetModules();
    const tempDir = await mkdtemp(join(tmpdir(), 'happier-heartbeat-timeout-'));
    const artifactPath = join(tempDir, 'timeout.json');
    const expectedExecutionCwd = process.cwd();
    try {
      vi.stubEnv('HAPPIER_TEST_WRAPPER_TIMEOUT_MS', '1500');
      vi.stubEnv('HAPPIER_TEST_TIMEOUT_ARTIFACT_PATH', artifactPath);
      vi.stubEnv('HAPPIER_STACK_REPO_DIR', '/workspace/happier');
      vi.stubEnv('HAPPIER_STACK_STACK', 'test-stack');
      vi.stubEnv('HAPPIER_SESSION_ID', 'session-123');
      vi.stubEnv('GITHUB_SHA', '');
      vi.stubEnv('CI_COMMIT_SHA', '');

      const runManagedChildCommand = vi.fn(async (params: { onMaxRuntime?: (timeoutMs: number) => void }) => {
        params.onMaxRuntime?.(1500);
        return {
          child: { pid: 12345 },
          ok: true,
          code: null,
          signal: 'SIGTERM',
          timedOut: true,
        };
      });
      vi.doMock('../../../../scripts/testing/process/managedChildLifecycle.mjs', () => ({
        installParentDeathCleanupWatchdog: () => () => {},
        resolveSignalExitCode: () => 143,
        runManagedChildCommand,
      }));
      vi.doMock('../../scripts/sweepProcessOwnershipLeases.mjs', () => ({
        sweepStaleProcessOwnershipLeases: vi.fn(async () => {}),
      }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code ?? ''}`);
      }) as never);

      const { runHeartbeatWrappedCommand } = await import('../../scripts/runPlaywrightWithHeartbeat.shared.mjs');

      await expect(runHeartbeatWrappedCommand({
        command: 'yarn',
        args: [
          '-s',
          'playwright',
          'test',
          '--token',
          'do-not-record',
          '--header',
          'Authorization: Bearer header-secret',
          '--env=API_TOKEN=environment-secret',
          'https://user:url-secret@example.test/suite',
        ],
        config: 'config-secret',
        toolName: 'playwright',
        spawnOptions: createPlaywrightSpawnOptions({ CI: '1' }),
        resolveExitCode: () => 143,
      })).rejects.toThrow('process.exit:124');

      expect(runManagedChildCommand).toHaveBeenCalledOnce();
      expect(JSON.parse(await readFile(artifactPath, 'utf8'))).toEqual(expect.objectContaining({
        classification: 'timeout',
        timeoutMs: 1500,
        timestamp: expect.any(String),
        command: {
          tool: 'playwright',
          argumentCount: 9,
          configured: true,
        },
        identity: {
          executionCwd: expectedExecutionCwd,
          stackRepoDir: '/workspace/happier',
          stack: 'test-stack',
          session: 'session-123',
        },
      }));
      const artifactText = await readFile(artifactPath, 'utf8');
      const logText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
      for (const secret of [
        'do-not-record',
        'header-secret',
        'environment-secret',
        'url-secret',
        'config-secret',
      ]) {
        expect(artifactText).not.toContain(secret);
        expect(logText).not.toContain(secret);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not write a timeout artifact after a successful run', async () => {
    vi.resetModules();
    const tempDir = await mkdtemp(join(tmpdir(), 'happier-heartbeat-success-'));
    const artifactPath = join(tempDir, 'timeout.json');
    try {
      vi.stubEnv('HAPPIER_TEST_TIMEOUT_ARTIFACT_PATH', artifactPath);
      vi.doMock('../../../../scripts/testing/process/managedChildLifecycle.mjs', () => ({
        installParentDeathCleanupWatchdog: () => () => {},
        resolveSignalExitCode: () => 1,
        runManagedChildCommand: vi.fn(async () => ({
          child: { pid: 12345 },
          ok: true,
          code: 0,
          signal: null,
          timedOut: false,
        })),
      }));
      vi.doMock('../../scripts/sweepProcessOwnershipLeases.mjs', () => ({
        sweepStaleProcessOwnershipLeases: vi.fn(async () => {}),
      }));

      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code ?? ''}`);
      }) as never);

      const { runHeartbeatWrappedCommand } = await import('../../scripts/runPlaywrightWithHeartbeat.shared.mjs');
      await expect(runHeartbeatWrappedCommand({
        command: 'yarn',
        args: ['-s', 'playwright', 'test'],
        config: 'playwright.ui.config.mjs',
        toolName: 'playwright',
        spawnOptions: createPlaywrightSpawnOptions({ CI: '1' }),
        resolveExitCode: () => 0,
      })).rejects.toThrow('process.exit:0');

      await expect(readFile(artifactPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('warns without masking exit code 124 when the timeout artifact cannot be written', async () => {
    vi.resetModules();
    const tempDir = await mkdtemp(join(tmpdir(), 'happier-heartbeat-timeout-write-failure-secret-marker-'));
    try {
      vi.stubEnv('HAPPIER_TEST_WRAPPER_TIMEOUT_MS', '1500');
      vi.stubEnv('HAPPIER_TEST_TIMEOUT_ARTIFACT_PATH', tempDir);
      vi.doMock('../../../../scripts/testing/process/managedChildLifecycle.mjs', () => ({
        installParentDeathCleanupWatchdog: () => () => {},
        resolveSignalExitCode: () => 143,
        runManagedChildCommand: vi.fn(async () => ({
          child: { pid: 12345 },
          ok: true,
          code: null,
          signal: 'SIGTERM',
          timedOut: true,
        })),
      }));
      vi.doMock('../../scripts/sweepProcessOwnershipLeases.mjs', () => ({
        sweepStaleProcessOwnershipLeases: vi.fn(async () => {}),
      }));

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code ?? ''}`);
      }) as never);

      const { runHeartbeatWrappedCommand } = await import('../../scripts/runPlaywrightWithHeartbeat.shared.mjs');
      await expect(runHeartbeatWrappedCommand({
        command: 'yarn',
        args: ['-s', 'playwright', 'test'],
        config: 'playwright.ui.config.mjs',
        toolName: 'playwright',
        spawnOptions: createPlaywrightSpawnOptions({ CI: '1' }),
        resolveExitCode: () => 143,
      })).rejects.toThrow('process.exit:124');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('timeout artifact'));
      expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('secret-marker');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
