import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StressConfig } from '../config/stressScenarioSchema';

const baseConfig: StressConfig = {
  targetMode: 'full-compose',
  baseUrl: undefined,
  repeat: 1,
  seed: 42,
  flakeRetry: false,
  socketTransport: 'websocket',
  duration: {
    warmupMs: 1000,
    durationMs: 10000,
    cooldownMs: 1000,
    soakMs: 0,
  },
  load: {
    users: 25,
    machinesPerUser: 1,
    sessionsPerUser: 1,
    rpcListenersPerUser: 1,
    rpcCallsPerSecond: 2,
    messagesPerSecond: 5,
    reconnectRate: 0,
    mixedSessionMode: 'representative',
  },
  orchestration: {
    rollingRestartEnabled: true,
    killTarget: 'api',
    expectedApiReplicas: 2,
    expectedWorkerReplicas: 1,
  },
  compose: {
    apiReplicas: 2,
    workerReplicas: 1,
    imageBuildStrategy: 'if-missing',
    reuseRunningTopology: false,
    gatewayPort: undefined,
    postgresPort: undefined,
    redisPort: undefined,
    minioPort: undefined,
    minioConsolePort: undefined,
    metricsEnabled: true,
    filesBackend: 's3',
  },
  artifacts: {
    saveArtifactsOnSuccess: false,
    metricsScrapeEnabled: true,
    keepTopologyOnFailure: false,
    summaryOutputPath: undefined,
  },
};

type ComposeCliModule = Awaited<typeof import('./stressComposeCli')>;

function createStartedTarget(params: {
  baseUrl: string;
  composeProjectName: string;
  composeFilePath: string;
  gatewayConfigFile?: string;
  generatedEnvFile?: string;
  dockerLogsFile?: string;
}) {
  return {
    mode: 'full-compose' as const,
    baseUrl: params.baseUrl,
    topology: {
      kind: 'full-compose' as const,
      composeProjectName: params.composeProjectName,
      services: ['gateway', 'api', 'worker', 'redis', 'postgres', 'minio'],
      expectedApiReplicas: 2,
      expectedWorkerReplicas: 1,
      resolvedApiReplicas: 2,
      resolvedWorkerReplicas: 1,
      baseUrl: params.baseUrl,
      ports: {
        gateway: Number.parseInt(params.baseUrl.split(':').at(-1) ?? '0', 10),
      },
    },
    artifacts: {
      composeFile: params.composeFilePath,
      gatewayConfigFile: params.gatewayConfigFile,
      generatedEnvFile: params.generatedEnvFile,
      dockerLogsFile: params.dockerLogsFile,
    },
    preserveForInspection: () => {},
    stop: async () => {},
    collectDiagnostics: async () => {},
  };
}

async function loadStressComposeCliModule(): Promise<ComposeCliModule> {
  vi.resetModules();
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  process.argv = ['node', 'stressComposeCli.ts', '__vitest__'];

  try {
    const mod = await import('./stressComposeCli');
    await Promise.resolve();
    process.exitCode = originalExitCode;
    return mod;
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stressComposeCli', () => {
  it('exposes a testable compose CLI factory', async () => {
    const mod = await loadStressComposeCliModule();

    expect(typeof mod.createStressComposeCli).toBe('function');
  });

  it('stops the previous running non-preserved compose project before replacing the latest state', async () => {
    const mod = await loadStressComposeCliModule();
    expect(typeof mod.createStressComposeCli).toBe('function');
    if (typeof mod.createStressComposeCli !== 'function') return;

    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    const firstDown = vi.fn(async () => {});
    const secondDown = vi.fn(async () => {});
    const createComposeRuntime = vi.fn(({ composeProjectName }: { composeProjectName: string }) => {
      if (composeProjectName === 'compose-first') {
        return {
          down: firstDown,
          imageExists: vi.fn(async () => false),
          inspectImage: vi.fn(async () => null),
        };
      }
      if (composeProjectName === 'compose-second') {
        return {
          down: secondDown,
          imageExists: vi.fn(async () => false),
          inspectImage: vi.fn(async () => null),
        };
      }
      throw new Error(`Unexpected compose project ${composeProjectName}`);
    });

    const startFullComposeStressTarget = vi
      .fn()
      .mockResolvedValueOnce(
        createStartedTarget({
          baseUrl: 'http://127.0.0.1:43080',
          composeProjectName: 'compose-first',
          composeFilePath: '/tmp/compose-first.yml',
          gatewayConfigFile: '/tmp/gateway-first.conf',
          generatedEnvFile: '/tmp/env-first.json',
          dockerLogsFile: '/tmp/docker-first.log',
        }),
      )
      .mockResolvedValueOnce(
        createStartedTarget({
          baseUrl: 'http://127.0.0.1:43081',
          composeProjectName: 'compose-second',
          composeFilePath: '/tmp/compose-second.yml',
          gatewayConfigFile: '/tmp/gateway-second.conf',
          generatedEnvFile: '/tmp/env-second.json',
          dockerLogsFile: '/tmp/docker-second.log',
        }),
      );

    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      readStressConfig: () => baseConfig,
      createRunDirs: () => ({
        runId: 'stress-run',
        runDir: scratchDir,
        testDir: () => join(scratchDir, 'compose-topology'),
      }),
      startFullComposeStressTarget,
      createComposeRuntime,
      repoRootDir: () => '/repo/root',
    });

    await cli.up();
    await cli.up();

    expect(firstDown).toHaveBeenCalledTimes(1);
    expect(startFullComposeStressTarget).toHaveBeenCalledTimes(2);
    expect(firstDown.mock.invocationCallOrder[0]).toBeLessThan(startFullComposeStressTarget.mock.invocationCallOrder[1]);

    const latestState = await cli.status();
    expect(latestState).toMatchObject({
      composeProjectName: 'compose-second',
      baseUrl: 'http://127.0.0.1:43081',
      status: 'running',
      preserved: false,
    });
  });

  it('does not stop the previous topology when the replacement has an invalid frozen-image pin', async () => {
    const mod = await loadStressComposeCliModule();
    expect(typeof mod.createStressComposeCli).toBe('function');
    if (typeof mod.createStressComposeCli !== 'function') return;

    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    writeFileSync(
      statePath,
      `${JSON.stringify({
        baseUrl: 'http://127.0.0.1:43080',
        composeProjectName: 'compose-running',
        composeFilePath: '/tmp/compose-running.yml',
        repoRootDir: '/repo/root',
        status: 'running',
        preserved: false,
      }, null, 2)}\n`,
      'utf8',
    );

    const previousDown = vi.fn(async () => {});
    const startFullComposeStressTarget = vi.fn(async () => {
      throw new Error('HAPPIER_STRESS_COMPOSE_IMAGE_FINGERPRINT is invalid');
    });
    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      readStressConfig: () => ({
        ...baseConfig,
        compose: {
          ...baseConfig.compose,
          imageBuildStrategy: 'never',
          imageFingerprint: 'not-a-sha1-fingerprint',
        },
      }),
      createRunDirs: () => ({
        runId: 'stress-run',
        runDir: scratchDir,
        testDir: () => join(scratchDir, 'compose-topology'),
      }),
      startFullComposeStressTarget,
      createComposeRuntime: vi.fn(() => ({
        down: previousDown,
        imageExists: vi.fn(async () => false),
        inspectImage: vi.fn(async () => null),
      })),
      repoRootDir: () => '/repo/root',
    });

    await expect(cli.up()).rejects.toThrow('HAPPIER_STRESS_COMPOSE_IMAGE_FINGERPRINT');

    expect(previousDown).not.toHaveBeenCalled();
    expect(startFullComposeStressTarget).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({
      composeProjectName: 'compose-running',
      status: 'running',
      preserved: false,
    });
  });

  it('does not tear down a preserved previous compose project during a replacement up', async () => {
    const mod = await loadStressComposeCliModule();
    expect(typeof mod.createStressComposeCli).toBe('function');
    if (typeof mod.createStressComposeCli !== 'function') return;

    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          baseUrl: 'http://127.0.0.1:43080',
          composeProjectName: 'compose-preserved',
          composeFilePath: '/tmp/compose-preserved.yml',
          repoRootDir: '/repo/root',
          status: 'running',
          preserved: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const previousDown = vi.fn(async () => {});
    const createComposeRuntime = vi.fn(() => ({
      down: previousDown,
      imageExists: vi.fn(async () => false),
      inspectImage: vi.fn(async () => null),
    }));

    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      readStressConfig: () => baseConfig,
      createRunDirs: () => ({
        runId: 'stress-run',
        runDir: scratchDir,
        testDir: () => join(scratchDir, 'compose-topology'),
      }),
      startFullComposeStressTarget: vi.fn(async () =>
        createStartedTarget({
          baseUrl: 'http://127.0.0.1:43081',
          composeProjectName: 'compose-replacement',
          composeFilePath: '/tmp/compose-replacement.yml',
        }),
      ),
      createComposeRuntime,
      repoRootDir: () => '/repo/root',
    });

    await cli.up();

    expect(previousDown).not.toHaveBeenCalled();
    expect(createComposeRuntime).not.toHaveBeenCalled();
  });

  it('marks the latest compose state as stopped so status stays coherent after down', async () => {
    const mod = await loadStressComposeCliModule();
    expect(typeof mod.createStressComposeCli).toBe('function');
    if (typeof mod.createStressComposeCli !== 'function') return;

    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    const down = vi.fn(async () => {});

    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      readStressConfig: () => baseConfig,
      createRunDirs: () => ({
        runId: 'stress-run',
        runDir: scratchDir,
        testDir: () => join(scratchDir, 'compose-topology'),
      }),
      startFullComposeStressTarget: vi.fn(async () =>
        createStartedTarget({
          baseUrl: 'http://127.0.0.1:43080',
          composeProjectName: 'compose-running',
          composeFilePath: '/tmp/compose-running.yml',
        }),
      ),
      createComposeRuntime: vi.fn(() => ({
        down,
        imageExists: vi.fn(async () => false),
        inspectImage: vi.fn(async () => null),
      })),
      repoRootDir: () => '/repo/root',
    });

    await cli.up();
    const downResult = await cli.down();
    const status = await cli.status();

    expect(down).toHaveBeenCalledTimes(1);
    expect(downResult).toMatchObject({
      composeProjectName: 'compose-running',
      stopped: true,
      status: 'stopped',
    });
    expect(status).toMatchObject({
      composeProjectName: 'compose-running',
      status: 'stopped',
      preserved: false,
    });
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({
      composeProjectName: 'compose-running',
      status: 'stopped',
    });
  });

  it('carries the runtime compose pointer and deletes the private runtime material on final down', async () => {
    const mod = await loadStressComposeCliModule();
    const privateMaterial = await import('../docker/privateComposeRuntimeMaterial');
    const secretSafety = await import('../../artifactSecretSafety');

    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    const retainedComposeFile = join(scratchDir, 'topology', 'docker-compose.yml');
    mkdirSync(dirname(retainedComposeFile), { recursive: true });
    writeFileSync(retainedComposeFile, 'services: {}\n', 'utf8');
    const material = privateMaterial.createPrivateComposeRuntimeMaterial({
      composeProjectName: 'compose-running',
      composeYaml: 'services: {}\n',
      secretValues: ['sentinel-cross-process-compose-secret-0123456789abcdef'],
    });
    secretSafety.clearRegisteredRuntimeSecretValues();
    let scrubbedInsideDown = '';
    const down = vi.fn(async () => {
      scrubbedInsideDown = secretSafety.scrubKnownSecretValues(
        'failure sentinel-cross-process-compose-secret-0123456789abcdef',
      );
    });

    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      readStressConfig: () => baseConfig,
      createRunDirs: () => ({
        runId: 'stress-run',
        runDir: scratchDir,
        testDir: () => join(scratchDir, 'compose-topology'),
      }),
      startFullComposeStressTarget: vi.fn(async () => ({
        ...createStartedTarget({
          baseUrl: 'http://127.0.0.1:43080',
          composeProjectName: 'compose-running',
          composeFilePath: retainedComposeFile,
        }),
        artifacts: {
          composeFile: retainedComposeFile,
          runtimeComposeFile: material.composeFile,
        },
      })),
      createComposeRuntime: vi.fn(() => ({
        down,
        imageExists: vi.fn(async () => false),
        inspectImage: vi.fn(async () => null),
      })),
      repoRootDir: () => '/repo/root',
    });

    await cli.up();
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({
      composeFilePath: retainedComposeFile,
      runtimeComposeFile: material.composeFile,
    });

    await cli.down();

    expect(down).toHaveBeenCalledTimes(1);
    expect(scrubbedInsideDown).toBe(`failure ${secretSafety.REDACTED_SECRET_PLACEHOLDER}`);
    expect(existsSync(material.composeFile)).toBe(false);
    expect(existsSync(material.dir)).toBe(false);
    expect(existsSync(retainedComposeFile)).toBe(true);
    secretSafety.clearRegisteredRuntimeSecretValues();
  });

  it('cleans up the previous private runtime material when up replaces a running topology', async () => {
    const mod = await loadStressComposeCliModule();
    const privateMaterial = await import('../docker/privateComposeRuntimeMaterial');

    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    const previousMaterial = privateMaterial.createPrivateComposeRuntimeMaterial({
      composeProjectName: 'compose-first',
      composeYaml: 'services: {}\n',
    });
    const firstDown = vi.fn(async () => {});

    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      readStressConfig: () => baseConfig,
      createRunDirs: () => ({
        runId: 'stress-run',
        runDir: scratchDir,
        testDir: () => join(scratchDir, 'compose-topology'),
      }),
      startFullComposeStressTarget: vi.fn(async () =>
        createStartedTarget({
          baseUrl: 'http://127.0.0.1:43081',
          composeProjectName: 'compose-second',
          composeFilePath: '/tmp/compose-second.yml',
        })),
      createComposeRuntime: vi.fn(() => ({
        down: firstDown,
        imageExists: vi.fn(async () => false),
        inspectImage: vi.fn(async () => null),
      })),
      repoRootDir: () => '/repo/root',
    });

    writeFileSync(
      statePath,
      `${JSON.stringify({
        baseUrl: 'http://127.0.0.1:43080',
        composeProjectName: 'compose-first',
        composeFilePath: '/tmp/compose-first.yml',
        runtimeComposeFile: previousMaterial.composeFile,
        repoRootDir: '/repo/root',
        status: 'running',
        preserved: false,
      }, null, 2)}\n`,
      'utf8',
    );

    await cli.up();

    expect(firstDown).toHaveBeenCalledTimes(1);
    expect(existsSync(previousMaterial.dir)).toBe(false);
  });

  it('retains private runtime material and running state when final down fails so teardown can retry', async () => {
    const mod = await loadStressComposeCliModule();
    const privateMaterial = await import('../docker/privateComposeRuntimeMaterial');
    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    const material = privateMaterial.createPrivateComposeRuntimeMaterial({
      composeProjectName: 'compose-running',
      composeYaml: 'services: {}\n',
      secretValues: ['sentinel-retry-secret-0123456789abcdef'],
    });
    writeFileSync(statePath, `${JSON.stringify({
      baseUrl: 'http://127.0.0.1:43080',
      composeProjectName: 'compose-running',
      composeFilePath: join(scratchDir, 'retained-compose.yml'),
      runtimeComposeFile: material.composeFile,
      repoRootDir: '/repo/root',
      status: 'running',
      preserved: false,
    }, null, 2)}\n`, 'utf8');
    const teardownFailure = new Error('docker teardown failed');
    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      createComposeRuntime: vi.fn(() => ({
        down: vi.fn(async () => { throw teardownFailure; }),
        imageExists: vi.fn(async () => false),
        inspectImage: vi.fn(async () => null),
      })),
    });

    await expect(cli.down()).rejects.toBe(teardownFailure);

    expect(existsSync(material.composeFile)).toBe(true);
    expect(existsSync(material.secretValuesFile)).toBe(true);
    expect(await cli.status()).toMatchObject({ status: 'running', runtimeComposeFile: material.composeFile });
    privateMaterial.deletePrivateComposeRuntimeMaterial(material.composeFile);
  });

  it('retains prior private runtime material and does not start replacement when replacement teardown fails', async () => {
    const mod = await loadStressComposeCliModule();
    const privateMaterial = await import('../docker/privateComposeRuntimeMaterial');
    const scratchDir = mkdtempSync(join(tmpdir(), 'happier-stress-compose-cli-'));
    const statePath = join(scratchDir, 'latest-full-compose.json');
    const material = privateMaterial.createPrivateComposeRuntimeMaterial({
      composeProjectName: 'compose-running',
      composeYaml: 'services: {}\n',
      secretValues: ['sentinel-replacement-retry-secret-0123456789abcdef'],
    });
    writeFileSync(statePath, `${JSON.stringify({
      baseUrl: 'http://127.0.0.1:43080',
      composeProjectName: 'compose-running',
      composeFilePath: join(scratchDir, 'retained-compose.yml'),
      runtimeComposeFile: material.composeFile,
      repoRootDir: '/repo/root',
      status: 'running',
      preserved: false,
    }, null, 2)}\n`, 'utf8');
    const teardownFailure = new Error('replacement teardown failed');
    const startReplacement = vi.fn();
    const cli = mod.createStressComposeCli({
      latestComposeStatePath: () => statePath,
      readStressConfig: () => baseConfig,
      preflightFullComposeFrozenImage: vi.fn(async () => {}),
      startFullComposeStressTarget: startReplacement,
      createComposeRuntime: vi.fn(() => ({
        down: vi.fn(async () => { throw teardownFailure; }),
        imageExists: vi.fn(async () => false),
        inspectImage: vi.fn(async () => null),
      })),
      repoRootDir: () => '/repo/root',
    });

    await expect(cli.up()).rejects.toBe(teardownFailure);

    expect(startReplacement).not.toHaveBeenCalled();
    expect(existsSync(material.composeFile)).toBe(true);
    expect(await cli.status()).toMatchObject({ status: 'running', runtimeComposeFile: material.composeFile });
    privateMaterial.deletePrivateComposeRuntimeMaterial(material.composeFile);
  });
});
