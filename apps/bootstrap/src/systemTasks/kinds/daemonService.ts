import { systemTasks } from '@happier-dev/cli-common';
import type { DaemonServiceKindDeps } from '@happier-dev/cli-common/systemTasks';
import { normalizeBootstrapChannel } from '../taskRuntime.js';
import { reportCliAcquisitionProgress } from '../cliAcquisitionProgress.js';

import {
  readDaemonStatus,
  startService,
  restartService,
  stopService,
} from '../localDaemonCli.js';

function resolveReleaseRingFromChannel(channel: unknown) {
  const normalized = String(channel ?? '').trim();
  if (!normalized) return undefined;
  return normalizeBootstrapChannel(normalized).releaseChannel;
}

const daemonServiceDeps: DaemonServiceKindDeps = {
  readStatus: async (params, context) => await readDaemonStatus({
    releaseRing: resolveReleaseRingFromChannel(params.channel),
    signal: context?.signal,
    onProgress: context ? reportCliAcquisitionProgress(context.emit) : undefined,
  }),
  startService: async (params) => await startService({ releaseRing: resolveReleaseRingFromChannel(params.channel) }),
  stopService: async (params) => await stopService({ releaseRing: resolveReleaseRingFromChannel(params.channel) }),
  restartService: async (params) => await restartService({ releaseRing: resolveReleaseRingFromChannel(params.channel) }),
};

export function createDaemonServiceStatusHandler() {
  const kind = systemTasks.createDaemonServiceStatusTaskKind(daemonServiceDeps);
  return systemTasks.createExecutionRunnerFromKind(kind);
}

export function createDaemonServiceStartHandler() {
  const kind = systemTasks.createDaemonServiceStartTaskKind(daemonServiceDeps);
  return systemTasks.createExecutionRunnerFromKind(kind);
}

export function createDaemonServiceStopHandler() {
  const kind = systemTasks.createDaemonServiceStopTaskKind(daemonServiceDeps);
  return systemTasks.createExecutionRunnerFromKind(kind);
}

export function createDaemonServiceRestartHandler() {
  const kind = systemTasks.createDaemonServiceRestartTaskKind(daemonServiceDeps);
  return systemTasks.createExecutionRunnerFromKind(kind);
}
