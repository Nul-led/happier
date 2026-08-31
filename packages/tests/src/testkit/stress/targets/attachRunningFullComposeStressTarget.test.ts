import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearRegisteredRuntimeSecretValues, REDACTED_SECRET_PLACEHOLDER } from '../../artifactSecretSafety';
import type { StressConfig } from '../config/stressScenarioSchema';
import { attachRunningFullComposeStressTarget } from './attachRunningFullComposeStressTarget';

const config: StressConfig = {
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
    users: 10,
    machinesPerUser: 1,
    sessionsPerUser: 1,
    rpcListenersPerUser: 1,
    rpcCallsPerSecond: 2,
    messagesPerSecond: 2,
    reconnectRate: 0,
    mixedSessionMode: 'representative',
  },
  orchestration: {
    rollingRestartEnabled: false,
    killTarget: 'none',
    expectedApiReplicas: 2,
    expectedWorkerReplicas: 1,
  },
  compose: {
    apiReplicas: 2,
    workerReplicas: 1,
    imageBuildStrategy: 'if-missing',
    reuseRunningTopology: true,
    frontDoorMode: 'gateway',
    gatewayPort: undefined,
    apiDirectPort: undefined,
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

describe('attachRunningFullComposeStressTarget', () => {
  it('attaches to the latest running compose topology and exposes admin hooks without tearing it down on stop', async () => {
    const testDir = mkdtempSync(join(tmpdir(), 'happier-stress-attach-'));
    const privateMaterial = await import('../docker/privateComposeRuntimeMaterial');
    const runtimeMaterial = privateMaterial.createPrivateComposeRuntimeMaterial({
      composeProjectName: 'compose-running',
      composeYaml: 'services: {}\n',
    });
    const generatedEnvFile = join(testDir, 'env.generated.json');
    const gatewayConfigFile = join(testDir, 'nginx.conf');
    writeFileSync(generatedEnvFile, JSON.stringify({
      compose: {
        apiReplicas: 2,
        workerReplicas: 1,
        frontDoorMode: 'gateway',
        metricsEnabled: true,
        filesBackend: 's3',
      },
      ports: {
        gateway: 43080,
        postgres: 45432,
        redis: 46379,
        minio: 49000,
        minioConsole: 49001,
      },
    }), 'utf8');
    writeFileSync(gatewayConfigFile, 'server { listen 8080; }\n', 'utf8');

    const runtime = {
      down: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      stopContainer: vi.fn(async () => {}),
      killContainer: vi.fn(async () => {}),
      ps: vi.fn(async () => '[]'),
      logs: vi.fn(async () => 'compose logs'),
      execCapture: vi.fn(async () => 'worker metrics'),
      inspectContainers: vi.fn(async () => []),
      serviceContainerIds: vi.fn(async () => []),
    };

    const target = await attachRunningFullComposeStressTarget(
      {
        config,
        testDir,
      },
      {
        latestComposeStatePath: () => join(testDir, 'latest-full-compose.json'),
        readLatestComposeState: () => ({
          baseUrl: 'http://127.0.0.1:43080',
          composeProjectName: 'compose-running',
          composeFilePath: '/tmp/docker-compose.yml',
          runtimeComposeFile: runtimeMaterial.composeFile,
          gatewayConfigFile,
          generatedEnvFile,
          dockerLogsFile: '/tmp/docker-compose.logs.txt',
          dockerPsFile: '/tmp/docker-compose.ps.txt',
          repoRootDir: '/repo/root',
          status: 'running',
          preserved: false,
        }),
        createComposeRuntime: vi.fn(() => runtime as never),
        waitForComposeTopology: vi.fn(async () => {}),
        waitForComposeRpcGatewayReadiness: vi.fn(async () => {}),
        inspectComposeTopology: vi.fn(async () => ({
          services: ['postgres', 'redis', 'api', 'worker', 'gateway'],
          resolvedApiReplicas: 2,
          resolvedWorkerReplicas: 1,
          ports: {
            gateway: 43080,
            postgres: 45432,
            redis: 46379,
            minio: 49000,
            minioConsole: 49001,
          },
        })),
        repoRootDir: () => '/repo/root',
      },
    );

    expect(target.baseUrl).toBe('http://127.0.0.1:43080');
    expect(target.topology.composeProjectName).toBe('compose-running');
    expect(target.topology.resolvedApiReplicas).toBe(2);

    const updatedGatewayConfig = await target.admin?.writeGatewayConfig('override.nginx.conf', 'server { listen 8081; }\n');
    expect(updatedGatewayConfig).toContain('override.nginx.conf');
    await target.admin?.activateGatewayConfig(updatedGatewayConfig ?? '');
    expect(runtime.restart).toHaveBeenCalledWith('gateway');

    await target.restartService?.('api');
    expect(runtime.restart).toHaveBeenCalledWith('api');

    await target.stop();
    expect(runtime.down).not.toHaveBeenCalled();
    privateMaterial.deletePrivateComposeRuntimeMaterial(runtimeMaterial.composeFile);
  });

  it('fails fast when the running topology shape does not match the requested compose metrics setting', async () => {
    const testDir = mkdtempSync(join(tmpdir(), 'happier-stress-attach-'));
    const generatedEnvFile = join(testDir, 'env.generated.json');
    writeFileSync(generatedEnvFile, JSON.stringify({
      compose: {
        apiReplicas: 2,
        workerReplicas: 1,
        frontDoorMode: 'gateway',
        metricsEnabled: false,
        filesBackend: 's3',
      },
      ports: {
        gateway: 43080,
      },
    }), 'utf8');

    await expect(
      attachRunningFullComposeStressTarget(
        {
          config,
          testDir,
        },
        {
          latestComposeStatePath: () => join(testDir, 'latest-full-compose.json'),
          readLatestComposeState: () => ({
            baseUrl: 'http://127.0.0.1:43080',
            composeProjectName: 'compose-running',
            composeFilePath: '/tmp/docker-compose.yml',
            generatedEnvFile,
            repoRootDir: '/repo/root',
            status: 'running',
            preserved: false,
          }),
          createComposeRuntime: vi.fn(() => ({
            down: vi.fn(async () => {}),
          }) as never),
          waitForComposeTopology: vi.fn(async () => {}),
          waitForComposeRpcGatewayReadiness: vi.fn(async () => {}),
          inspectComposeTopology: vi.fn(async () => ({
            services: ['postgres', 'redis', 'api', 'worker', 'gateway'],
            resolvedApiReplicas: 2,
            resolvedWorkerReplicas: 1,
            ports: {
              gateway: 43080,
            },
          })),
          repoRootDir: () => '/repo/root',
        },
      ),
    ).rejects.toThrow(/metricsEnabled/);
  });

  afterEach(() => {
    clearRegisteredRuntimeSecretValues();
  });

  it('manages the running topology through its private runtime compose material and scrubs captured diagnostics', async () => {
    const testDir = mkdtempSync(join(tmpdir(), 'happier-stress-attach-private-'));
    const generatedEnvFile = join(testDir, 'env.generated.json');
    const dockerLogsFile = join(testDir, 'docker-compose.logs.txt');
    writeFileSync(generatedEnvFile, JSON.stringify({
      compose: { apiReplicas: 2, workerReplicas: 1, frontDoorMode: 'gateway', metricsEnabled: true, filesBackend: 's3' },
      ports: { gateway: 43080 },
    }), 'utf8');

    const masterSecret = 'sentinel-attach-master-secret-0123456789abcdef';
    const privateMaterial = await import('../docker/privateComposeRuntimeMaterial');
    const material = privateMaterial.createPrivateComposeRuntimeMaterial({
      composeProjectName: 'compose-running',
      composeYaml: 'services: {}\n',
      secretValues: [masterSecret],
    });

    const runtime = {
      down: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      ps: vi.fn(async () => 'ps output'),
      logs: vi.fn(async () => `api-1 | HANDY_MASTER_SECRET=${masterSecret}`),
      execCapture: vi.fn(async () => 'worker metrics'),
      inspectContainers: vi.fn(async () => []),
      serviceContainerIds: vi.fn(async () => []),
    };
    const createComposeRuntime = vi.fn(() => runtime as never);

    const target = await attachRunningFullComposeStressTarget(
      { config, testDir },
      {
        latestComposeStatePath: () => join(testDir, 'latest-full-compose.json'),
        readLatestComposeState: () => ({
          baseUrl: 'http://127.0.0.1:43080',
          composeProjectName: 'compose-running',
          composeFilePath: join(testDir, 'topology', 'docker-compose.yml'),
          runtimeComposeFile: material.composeFile,
          generatedEnvFile,
          dockerLogsFile,
          repoRootDir: '/repo/root',
          status: 'running',
          preserved: false,
        }),
        createComposeRuntime,
        waitForComposeTopology: vi.fn(async () => {}),
        waitForComposeRpcGatewayReadiness: vi.fn(async () => {}),
        inspectComposeTopology: vi.fn(async () => ({
          services: ['postgres', 'redis', 'api', 'worker', 'gateway'],
          resolvedApiReplicas: 2,
          resolvedWorkerReplicas: 1,
          ports: { gateway: 43080 },
        })),
        repoRootDir: () => '/repo/root',
      },
    );

    expect(createComposeRuntime).toHaveBeenCalledWith(expect.objectContaining({
      composeFilePath: material.composeFile,
    }));
    expect(target.artifacts?.runtimeComposeFile).toBe(material.composeFile);

    await target.collectDiagnostics();
    const logs = readFileSync(dockerLogsFile, 'utf8');
    expect(logs).not.toContain(masterSecret);
    expect(logs).toContain(`HANDY_MASTER_SECRET=${REDACTED_SECRET_PLACEHOLDER}`);

    await target.stop();
    expect(runtime.down).not.toHaveBeenCalled();
    expect(existsSync(material.composeFile)).toBe(true);
  });

  it('fails closed when the private runtime compose material is missing for a running topology', async () => {
    const testDir = mkdtempSync(join(tmpdir(), 'happier-stress-attach-missing-'));
    const generatedEnvFile = join(testDir, 'env.generated.json');
    writeFileSync(generatedEnvFile, JSON.stringify({
      compose: { apiReplicas: 2, workerReplicas: 1, frontDoorMode: 'gateway', metricsEnabled: true, filesBackend: 's3' },
      ports: { gateway: 43080 },
    }), 'utf8');

    await expect(
      attachRunningFullComposeStressTarget(
        { config, testDir },
        {
          latestComposeStatePath: () => join(testDir, 'latest-full-compose.json'),
          readLatestComposeState: () => ({
            baseUrl: 'http://127.0.0.1:43080',
            composeProjectName: 'compose-running',
            composeFilePath: join(testDir, 'topology', 'docker-compose.yml'),
            runtimeComposeFile: join(tmpdir(), 'happier-stress-compose-runtime', 'does-not-exist', 'docker-compose.yml'),
            generatedEnvFile,
            repoRootDir: '/repo/root',
            status: 'running',
            preserved: false,
          }),
          createComposeRuntime: vi.fn(() => {
            throw new Error('must not build a runtime from the redacted compose file');
          }),
          waitForComposeTopology: vi.fn(async () => {}),
          waitForComposeRpcGatewayReadiness: vi.fn(async () => {}),
          inspectComposeTopology: vi.fn(async () => ({
            services: [],
            resolvedApiReplicas: 0,
            resolvedWorkerReplicas: 0,
            ports: {},
          })),
          repoRootDir: () => '/repo/root',
        },
      ),
    ).rejects.toThrow(/runtime compose material.*missing|missing.*runtime compose material/iu);
  });
});
