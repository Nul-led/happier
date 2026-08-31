import { createConnection } from 'node:net';
import { homedir } from 'node:os';

import {
  createRelayHostEngine,
  createPersonalHomeSystemTaskOperations,
  ensureLocalFirstPartyComponentCommand,
  type RelayHostEngine,
  type RelayHostEngineDeps,
  type RelayRuntimeStatusSnapshot,
  type RelayRuntimeTaskParams,
  type PersonalHomeSystemTaskOperations,
} from '@happier-dev/cli-common/systemTasks';
import {
  checkRelayRuntimeHealth,
  createCanonicalPersonalHomeOperations,
  listInstalledVersionIdsNewestFirst,
  PersonalHomeOperationsError,
  type RelayRuntimeHealthResult,
} from '@happier-dev/cli-common/firstPartyRuntime';
import { normalizePublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import { runCommandStreaming } from '@happier-dev/cli-common/process';

type LiveRelayRuntimeServiceStatus = RelayRuntimeStatusSnapshot['service'];

function requireLocalRelayRuntimeParams(params: RelayRuntimeTaskParams): RelayRuntimeTaskParams {
  if (params.target.kind !== 'local') {
    throw new Error('Live relay runtime tasks only support local targets');
  }
  return { ...params, target: { kind: 'local' as const } };
}

// Local-only engine wiring: live relay runtime tasks never target remote hosts,
// so the remote dependency seams fail closed instead of opening a second remote
// installation path. All platform/process behavior stays in the canonical
// engine.
export function createLocalRelayHostEngine(extraDeps: Partial<Pick<RelayHostEngineDeps, 'resolveLocalInstallVersion'>> = {}): RelayHostEngine {
  return createRelayHostEngine({
    installRemoteComponent: async () => {
      throw new Error('Remote component installation is not available for live relay runtime tasks.');
    },
    resolveRemoteReleaseTarget: async () => {
      throw new Error('Remote relay targets are not available for live relay runtime tasks.');
    },
    runRemoteText: async () => {
      throw new Error('Remote relay execution is not available for live relay runtime tasks.');
    },
    copyLocalDirectoryToRemote: async () => {
      throw new Error('Remote relay copy is not available for live relay runtime tasks.');
    },
    ...(extraDeps.resolveLocalInstallVersion ? { resolveLocalInstallVersion: extraDeps.resolveLocalInstallVersion } : {}),
  });
}

export async function createLivePersonalHomeSystemTaskOperations(params: Readonly<{
  channel?: 'stable' | 'preview' | 'dev';
  mode?: 'user' | 'system';
}> = {}): Promise<PersonalHomeSystemTaskOperations> {
  const engine = createLocalRelayHostEngine();
  const runtimeParams = {
    target: { kind: 'local' as const },
    channel: params.channel ?? 'stable',
    mode: params.mode ?? 'user',
  };
  const releaseRing = normalizePublicReleaseRingId(runtimeParams.channel) || 'stable';
  const operations = await createCanonicalPersonalHomeOperations({
    homeDir: homedir(),
    mode: runtimeParams.mode,
    channel: releaseRing,
    readPurpose: async () => {
      const purpose = (await engine.readStatus(runtimeParams)).purpose;
      if (purpose?.kind !== 'personal-home' || !purpose.canonicalServerUrl.trim()) {
        throw new PersonalHomeOperationsError(
          'purpose_not_personal_home',
          'Personal Home operations require a fresh personal-home runtime purpose.',
        );
      }
      return purpose;
    },
    runMigrationProcess: async ({ command, args, env }) => await runCommandStreaming({
      cmd: command,
      args: [...args],
      env,
      context: 'personal-home staged migration',
    }),
    lifecycle: {
      isRunning: async () => (await engine.readStatus(runtimeParams)).service.active === true,
      stop: async () => await engine.control({ ...runtimeParams, action: 'stop' }),
      start: async () => await engine.control({ ...runtimeParams, action: 'start' }),
      healthCheck: async () => {
        const snapshot = await engine.readStatus(runtimeParams);
        return typeof snapshot.healthy === 'boolean'
          ? snapshot.healthy
          : await checkLiveRelayRuntimeHealth({ baseUrl: snapshot.baseUrl });
      },
    },
    readHappierVersion: async () => (await engine.readStatus(runtimeParams)).version ?? 'unknown',
  });
  return createPersonalHomeSystemTaskOperations({ operations });
}

async function probePortOpen(params: Readonly<{ host: string; port: number; timeoutMs: number }>): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: params.host, port: params.port });
    const finish = (value: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(params.timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function fetchJson(params: Readonly<{ url: string; timeoutMs: number }>): Promise<Readonly<{ ok: boolean; status: number; body: unknown }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch(params.url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => ({})),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeRelayRuntimeHealthAtBaseUrl(baseUrl: string): Promise<RelayRuntimeHealthResult> {
  const url = new URL(baseUrl);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return await checkRelayRuntimeHealth({
    host: url.hostname,
    port,
    timeoutMs: 5_000,
    probePortOpen: async ({ host, port: probePort, timeoutMs }) => await probePortOpen({ host, port: probePort, timeoutMs }),
    fetchJson: async ({ url: requestUrl, timeoutMs }) => await fetchJson({ url: requestUrl, timeoutMs }),
  });
}

export async function readRelayRuntimeStatus(params: RelayRuntimeTaskParams): Promise<RelayRuntimeStatusSnapshot> {
  return await createLocalRelayHostEngine().readStatus(requireLocalRelayRuntimeParams(params));
}

export async function readLiveRelayRuntimeInstalledVersion(params: RelayRuntimeTaskParams): Promise<string | null> {
  return (await readRelayRuntimeStatus(params)).version;
}

export async function readLiveRelayRuntimeServiceStatus(params: RelayRuntimeTaskParams): Promise<LiveRelayRuntimeServiceStatus> {
  return (await readRelayRuntimeStatus(params)).service;
}

export async function readLiveRelayRuntimeHealth(params: RelayRuntimeTaskParams): Promise<RelayRuntimeHealthResult> {
  const status = await readRelayRuntimeStatus(params);
  return await probeRelayRuntimeHealthAtBaseUrl(status.baseUrl);
}

export async function checkLiveRelayRuntimeHealth(params: Readonly<{ baseUrl: string }>): Promise<boolean> {
  return (await probeRelayRuntimeHealthAtBaseUrl(params.baseUrl)).reachable;
}

export async function startRelayRuntime(params: RelayRuntimeTaskParams): Promise<void> {
  await createLocalRelayHostEngine().control({ ...requireLocalRelayRuntimeParams(params), action: 'start' });
}

export async function restartRelayRuntime(params: RelayRuntimeTaskParams): Promise<void> {
  await createLocalRelayHostEngine().control({ ...requireLocalRelayRuntimeParams(params), action: 'restart' });
}

export async function stopRelayRuntime(params: RelayRuntimeTaskParams): Promise<void> {
  await createLocalRelayHostEngine().control({ ...requireLocalRelayRuntimeParams(params), action: 'stop' });
}

export async function uninstallRelayRuntime(params: RelayRuntimeTaskParams): Promise<void> {
  await createLocalRelayHostEngine().control({ ...requireLocalRelayRuntimeParams(params), action: 'uninstall' });
}

export async function installOrUpdateRelayRuntime(params: RelayRuntimeTaskParams): Promise<Readonly<{ relayUrl: string; mode: 'user' | 'system' }>> {
  const localParams = requireLocalRelayRuntimeParams(params);
  const releaseRing = normalizePublicReleaseRingId(localParams.channel) || 'stable';
  const engine = createLocalRelayHostEngine({
    resolveLocalInstallVersion: async () => {
      if (localParams.selfHostRelayBinaryOverride) {
        return null;
      }
      return (await listInstalledVersionIdsNewestFirst({
        componentId: 'happier-server',
        processEnv: process.env,
        releaseRing,
      })).at(0) ?? null;
    },
  });
  const selfHostRelayBinaryOverride = localParams.selfHostRelayBinaryOverride
    ? localParams.selfHostRelayBinaryOverride
    : await ensureLocalFirstPartyComponentCommand({
        componentId: 'happier-server',
        processEnv: process.env,
        envVarNames: ['HAPPIER_SELF_HOST_SERVER_BINARY'],
        releaseRing,
      });

  return await engine.installOrUpdate({ ...localParams, selfHostRelayBinaryOverride });
}

export const readLiveRelayRuntimeStatus = readRelayRuntimeStatus;
export const startLiveRelayRuntime = startRelayRuntime;
export const restartLiveRelayRuntime = restartRelayRuntime;
export const stopLiveRelayRuntime = stopRelayRuntime;
export const uninstallLiveRelayRuntime = uninstallRelayRuntime;
export const installOrUpdateLiveRelayRuntime = installOrUpdateRelayRuntime;
