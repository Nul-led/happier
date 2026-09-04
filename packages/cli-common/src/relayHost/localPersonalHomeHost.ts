import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normalizePublicReleaseRingId, type PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import {
  checkRelayRuntimeHealth,
  resolveRelayRuntimeDefaults,
  type RelayRuntimeHealthResult,
} from '../firstPartyRuntime/relayRuntime.js';
import {
  attestPersonalHomeRelocationDestinationWithServerCommand,
  createCanonicalPersonalHomeOperations,
  createCanonicalPersonalHomeRelocationDestinationOwner,
  materializePersonalHomeRelocationEndpointWithServerCommand,
} from '../firstPartyRuntime/personalHome/productionAdapters.js';
import {
  readPersonalHomeStartupReadiness,
  removePersonalHomeStartupReadiness,
} from '../firstPartyRuntime/personalHome/readiness.js';
import {
  PersonalHomeOperationsError,
  type PersonalHomeOperations,
} from '../firstPartyRuntime/personalHome/operations.js';
import type { PersonalHomeRelocationDestinationOwner } from '../firstPartyRuntime/personalHome/relocationDestination.js';
import type { PersonalHomeMigrationProcessRunner } from '../firstPartyRuntime/personalHome/stagedMigrationFrontier.js';
import { runCommandStreaming } from '../process/runCommandStreaming.js';
import {
  createPersonalHomeSystemTaskOperations,
  type PersonalHomeSystemTaskOperations,
} from '../systemTasks/kinds/relayRuntimeKinds.js';
import type { RelayHostEngine } from './relayHostEngine.js';

/**
 * The single local Personal Home host composition. Hosts (CLI capability tasks,
 * hsetup bootstrap tasks) own only their process/transport boundaries — the
 * RelayHostEngine they build and the home directory they run against. Every
 * Personal Home dependency and policy above that boundary (readiness receipt
 * path, server binary path, purpose freshness, lifecycle mapping onto engine
 * control actions, staged-migration process context, relocation destination
 * attestation and endpoint materialization) is decided here so CLI and
 * bootstrap cannot drift apart.
 */
export type LocalPersonalHomeHostTarget = Readonly<{
  /** Host-owned relay engine: local-only in the CLI, SSH-capable in bootstrap. */
  engine: RelayHostEngine;
  /** Public channel label as accepted by the relay runtime task params. */
  channel: 'stable' | 'preview' | 'dev';
  mode: 'user' | 'system';
  /** Defaults to the current user's home directory. */
  homeDir?: string;
}>;

export type LocalPersonalHomeHost = Readonly<{
  /** Normalized release ring the Personal Home layout and defaults resolve against. */
  releaseRing: PublicReleaseRingId;
  createOperations(): Promise<PersonalHomeOperations>;
  createSystemTaskOperations(): Promise<PersonalHomeSystemTaskOperations>;
  createRelocationDestinationOwner(): Promise<PersonalHomeRelocationDestinationOwner>;
}>;

const HEALTH_PROBE_TIMEOUT_MS = 5_000;

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

async function fetchJson(params: Readonly<{ url: string; timeoutMs: number }>): Promise<Readonly<{
  ok: boolean;
  status: number;
  body: unknown;
}>> {
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

/** Live health probe against an engine-reported base URL, shared by every local host. */
export async function probeLocalRelayRuntimeHealth(params: Readonly<{ baseUrl: string }>): Promise<RelayRuntimeHealthResult> {
  const url = new URL(params.baseUrl);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return await checkRelayRuntimeHealth({
    host: url.hostname,
    port,
    timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
    probePortOpen: async ({ host, port: probePort, timeoutMs }) => await probePortOpen({ host, port: probePort, timeoutMs }),
    fetchJson: async ({ url: requestUrl, timeoutMs }) => await fetchJson({ url: requestUrl, timeoutMs }),
  });
}

/** Reachability verdict used wherever the engine snapshot carries no health value. */
export async function checkLocalRelayRuntimeReachability(params: Readonly<{ baseUrl: string }>): Promise<boolean> {
  return (await probeLocalRelayRuntimeHealth(params)).reachable;
}

export function createLocalPersonalHomeHost(target: LocalPersonalHomeHostTarget): LocalPersonalHomeHost {
  const { engine, mode } = target;
  const homeDir = String(target.homeDir ?? '').trim() || homedir();
  const releaseRing = normalizePublicReleaseRingId(target.channel) || 'stable';
  const runtimeParams = { target: { kind: 'local' as const }, channel: target.channel, mode };
  const defaults = resolveRelayRuntimeDefaults({ homeDir, mode, channel: releaseRing });
  const readinessPath = join(defaults.dataDir, 'startup-receipt.json');
  const serverBinary = join(
    defaults.installRoot,
    'bin',
    process.platform === 'win32' ? 'happier-server.exe' : 'happier-server',
  );

  const readPurpose = async () => {
    const purpose = (await engine.readStatus(runtimeParams)).purpose;
    if (purpose?.kind !== 'personal-home' || !purpose.canonicalServerUrl.trim()) {
      throw new PersonalHomeOperationsError(
        'purpose_not_personal_home',
        'Personal Home operations require a fresh personal-home runtime purpose.',
      );
    }
    return purpose;
  };
  const attestActivatedHome = async () => await readPersonalHomeStartupReadiness({ path: readinessPath });
  const readServiceStatus = async () => {
    const service = (await engine.readStatus(runtimeParams)).service;
    return { running: service.active === true, quarantined: service.active === false && service.enabled === false };
  };
  const activate = async (): Promise<void> => {
    await removePersonalHomeStartupReadiness(readinessPath);
    await engine.control({ ...runtimeParams, action: 'activate' });
  };
  const quarantine = async (): Promise<void> => {
    await engine.control({ ...runtimeParams, action: 'quarantine' });
  };
  const runMigrationProcess = (context: string): PersonalHomeMigrationProcessRunner => async ({ command, args, env }) => {
    await runCommandStreaming({ cmd: command, args: [...args], env, context });
  };

  const createOperations = async (): Promise<PersonalHomeOperations> => await createCanonicalPersonalHomeOperations({
    homeDir,
    mode,
    channel: releaseRing,
    readPurpose,
    runMigrationProcess: runMigrationProcess('personal-home staged migration'),
    lifecycle: {
      isRunning: async () => (await engine.readStatus(runtimeParams)).service.active === true,
      stop: async () => await engine.control({ ...runtimeParams, action: 'stop' }),
      start: async () => {
        await removePersonalHomeStartupReadiness(readinessPath);
        await engine.control({ ...runtimeParams, action: 'start' });
      },
      quarantine,
      activate,
      readServiceStatus,
      healthCheck: async () => {
        const snapshot = await engine.readStatus(runtimeParams);
        return typeof snapshot.healthy === 'boolean'
          ? snapshot.healthy
          : await checkLocalRelayRuntimeReachability({ baseUrl: snapshot.baseUrl });
      },
    },
    attestActivatedHome,
    readHappierVersion: async () => (await engine.readStatus(runtimeParams)).version ?? 'unknown',
  });

  return Object.freeze({
    releaseRing,
    createOperations,
    createSystemTaskOperations: async () => createPersonalHomeSystemTaskOperations({
      operations: await createOperations(),
    }),
    createRelocationDestinationOwner: async () => await createCanonicalPersonalHomeRelocationDestinationOwner({
      homeDir,
      mode,
      channel: releaseRing,
      quarantine,
      activate,
      readServiceStatus,
      attestActivatedHome,
      attestStagedHome: async ({ layout, operationId }) => await attestPersonalHomeRelocationDestinationWithServerCommand({
        layout,
        serverBinary,
        operationId,
      }),
      runMigrationProcess: runMigrationProcess('personal-home relocation destination staged migration'),
      materializeEndpoint: async ({ layout, operationId, sourceDescriptorRevision }) => {
        const status = await engine.readStatus(runtimeParams);
        const canonicalServerUrl = status.canonicalServerUrl?.trim() ?? '';
        if (!canonicalServerUrl) throw new Error('Relocation destination canonical server URL is unavailable');
        return await materializePersonalHomeRelocationEndpointWithServerCommand({
          layout,
          serverBinary,
          operationId,
          canonicalServerUrl,
          sourceDescriptorRevision,
        });
      },
    }),
  });
}
