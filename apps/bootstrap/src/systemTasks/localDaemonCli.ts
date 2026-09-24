import { systemTasks } from '@happier-dev/cli-common';
import type { FirstPartyAcquisitionOptions } from '@happier-dev/cli-common/firstPartyRuntime';
import { createLocalHappierJsonExecutor } from '@happier-dev/cli-common/systemTasks';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { runLocalHappierJsonCommand } from './happierCli.js';

export type DaemonStatusSnapshot = Readonly<{
  serviceInstalled: boolean;
  daemonRunning: boolean;
  needsAuth: boolean;
  machineId: string | null;
  daemonServerUrl: string | null;
  daemonComparableKey: string | null;
  daemonAccountId: string | null;
  daemonMachineRegistered: boolean | null;
}>;

type LocalDaemonCliOptions = FirstPartyAcquisitionOptions & Readonly<{
  releaseRing?: PublicReleaseRingId;
}>;

async function runScopedLocalHappierJsonCommand(
  args: readonly string[],
  options: LocalDaemonCliOptions & Readonly<{ allowJsonFailure?: boolean; onCommandReady?: () => void }> = {},
): Promise<unknown> {
  if (!options.releaseRing) {
    return await runLocalHappierJsonCommand({
      args,
      signal: options.signal,
      onProgress: options.onProgress,
      onCommandReady: options.onCommandReady,
      ...(typeof options.allowJsonFailure === 'boolean' ? { allowJsonFailure: options.allowJsonFailure } : {}),
    });
  }

  const executor = createLocalHappierJsonExecutor({
    releaseRing: options.releaseRing,
    signal: options.signal,
    onProgress: options.onProgress,
    onCommandReady: options.onCommandReady,
  });
  return await executor.runHappierJson(args, {
    ...(typeof options.allowJsonFailure === 'boolean' ? { allowJsonFailure: options.allowJsonFailure } : {}),
  });
}

export async function startService(options: LocalDaemonCliOptions = {}): Promise<void> {
  await runScopedLocalHappierJsonCommand(['service', 'start', '--json'], options);
}

export async function stopService(options: LocalDaemonCliOptions = {}): Promise<void> {
  await runScopedLocalHappierJsonCommand(['service', 'stop', '--json'], options);
}

export async function restartService(options: LocalDaemonCliOptions = {}): Promise<void> {
  await runScopedLocalHappierJsonCommand(['service', 'restart', '--json'], options);
}

export async function readDaemonStatus(options: LocalDaemonCliOptions = {}): Promise<DaemonStatusSnapshot> {
  const parsed = await runScopedLocalHappierJsonCommand(['daemon', 'status', '--json'], {
    ...options,
    onCommandReady: () => options.onProgress?.({ phase: 'checkingDaemon' }),
  });
  if (!parsed || typeof parsed !== 'object') {
    throw new systemTasks.SystemTaskExecutionError(
      'invalid_cli_response',
      'Received an invalid daemon status response.',
    );
  }

  const record = parsed as {
    daemon?: { running?: unknown };
    service?: { installed?: unknown };
    server?: { serverUrl?: unknown; comparableKey?: unknown };
    auth?: {
      needsAuth?: unknown;
      machineId?: unknown;
      accountId?: unknown;
      machineRegistered?: unknown;
    };
  };

  return {
    serviceInstalled: record.service?.installed === true,
    daemonRunning: record.daemon?.running === true,
    needsAuth: record.auth?.needsAuth === true,
    machineId: typeof record.auth?.machineId === 'string' && record.auth.machineId.trim()
      ? record.auth.machineId.trim()
      : null,
    daemonServerUrl: typeof record.server?.serverUrl === 'string' && record.server.serverUrl.trim()
      ? record.server.serverUrl.trim()
      : null,
    daemonComparableKey: typeof record.server?.comparableKey === 'string' && record.server.comparableKey.trim()
      ? record.server.comparableKey.trim()
      : null,
    daemonAccountId: typeof record.auth?.accountId === 'string' && record.auth.accountId.trim()
      ? record.auth.accountId.trim()
      : null,
    daemonMachineRegistered: typeof record.auth?.machineRegistered === 'boolean'
      ? record.auth.machineRegistered
      : null,
  };
}
