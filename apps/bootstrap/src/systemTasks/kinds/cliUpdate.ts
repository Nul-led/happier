import { systemTasks } from '@happier-dev/cli-common';
import { updateManagedLocalFirstPartyComponent } from '@happier-dev/cli-common/systemTasks';
import { formatPinnedDaemonServiceRestartCommand, planServiceDaemonsRestartAfterCliUpdate, type FirstPartyAcquisitionOptions, type ManagedCliUpdateRestart, type ServiceDaemonBeforeCliUpdate } from '@happier-dev/cli-common/firstPartyRuntime';
import { resolveCliInvokerNameForPublicRing } from '@happier-dev/release-runtime/releaseRings';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { reportCliAcquisitionProgress } from '../cliAcquisitionProgress.js';
import { readDaemonStatus, restartService } from '../localDaemonCli.js';
import { normalizeBootstrapChannel } from '../taskRuntime.js';

type CliUpdateTarget = Readonly<{ releaseRing?: PublicReleaseRingId; relayUrl?: string; serverIdentityId?: string }>;

type CliUpdateServiceStatus = Readonly<{
  serviceInstalled: boolean;
  daemonRunning: boolean;
  /** Whether the running daemon was started by its background service (`null` when unknown). */
  daemonServiceManaged: boolean | null;
  /** The CLI version the running daemon started with (`null` when none is running or unknown). */
  daemonCliVersion: string | null;
  serviceTargetMode?: 'default-following' | 'pinned' | null;
  serviceManagedBy?: 'desktop' | null;
  serviceServerId?: string | null;
}>;

export type CliUpdateDeps = Readonly<{
  /**
   * The one CLI update transaction (`updateManagedLocalFirstPartyComponent` → `runManagedCliUpdate`):
   * refuses `cli_not_managed` for any other CLI, fails `cli_update_rolled_back` / `cli_update_failed`
   * / `cli_update_smoke_failed` / `cli_update_in_progress` by name.
   */
  updateManagedCli: (params: FirstPartyAcquisitionOptions & Readonly<{
    releaseRing?: PublicReleaseRingId;
    /** Called once the CLI is known to be managed, before anything changes. */
    planServiceDaemonRestart: () => Promise<ManagedCliUpdateRestart | null>;
  }>) => Promise<Readonly<{
    previousVersion: string;
    version: string;
    restarted: boolean;
  }>>;
  readDaemonStatus: (target: CliUpdateTarget) => Promise<CliUpdateServiceStatus>;
  restartService: (target: CliUpdateTarget) => Promise<void>;
}>;

export type CliUpdateResult = Readonly<{
  previousVersion: string;
  version: string;
  restarted: boolean;
}>;

function parseCliUpdateParams(params: unknown): CliUpdateTarget {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new systemTasks.SystemTaskExecutionError('invalid_params', 'Expected CLI update params to be an object.');
  }
  const record = params as Record<string, unknown>;
  const target: { releaseRing?: PublicReleaseRingId; relayUrl?: string; serverIdentityId?: string } = {};
  if (record.channel !== undefined) {
    const channel = typeof record.channel === 'string' ? record.channel.trim().toLowerCase() : '';
    if (channel !== 'stable' && channel !== 'preview' && channel !== 'dev' && channel !== 'publicdev') {
      throw new systemTasks.SystemTaskExecutionError('invalid_params', `Unsupported channel: ${String(record.channel)}`);
    }
    target.releaseRing = normalizeBootstrapChannel(channel).releaseChannel;
  }
  if (record.relayUrl !== undefined) {
    if (typeof record.relayUrl !== 'string' || !record.relayUrl.trim()) {
      throw new systemTasks.SystemTaskExecutionError('invalid_params', 'relayUrl must be a non-empty string when provided.');
    }
    target.relayUrl = record.relayUrl.trim();
  }
  if (record.serverIdentityId !== undefined) {
    if (typeof record.serverIdentityId !== 'string' || !record.serverIdentityId.trim() || !target.relayUrl) {
      throw new systemTasks.SystemTaskExecutionError('invalid_params', 'serverIdentityId must be a non-empty string next to relayUrl when provided.');
    }
    target.serverIdentityId = record.serverIdentityId.trim();
  }
  return target;
}

const productionDeps: CliUpdateDeps = {
  updateManagedCli: async ({ releaseRing, signal, onProgress, planServiceDaemonRestart }) => await updateManagedLocalFirstPartyComponent({
    componentId: 'happier-cli',
    processEnv: process.env,
    ...(releaseRing ? { releaseRing } : {}),
    signal,
    onProgress,
    planServiceDaemonRestart,
  }),
  readDaemonStatus: async (target) => await readDaemonStatus(target),
  restartService: async (target) => await restartService(target),
};

/**
 * `cli.update.v1` (R17, plan R13 d/f): the desktop's one "Update" action. Runs the one CLI update
 * transaction on this channel's managed CLI. When the addressed Home's background service is
 * running its daemon, the transaction restarts it through the CLI service owner
 * (`service restart`, scoped by `relayUrl`) and proves it runs the new version; if that is not
 * proven, every piece of activation state is restored, the previous version is restarted and
 * proven, and the task fails `cli_update_rolled_back` (or `cli_update_failed` when that recovery
 * did not hold). A daemon that was not running is not started, and a manual daemon is not the
 * service's to restart. A CLI Happier did not install is refused by name (`cli_not_managed`).
 */
export function createCliUpdateTaskKind(overrides: Partial<CliUpdateDeps> = {}): systemTasks.InteractiveSystemTaskKind<CliUpdateResult> {
  const deps: CliUpdateDeps = { ...productionDeps, ...overrides };
  return {
    async run(ctx) {
      const target = parseCliUpdateParams(ctx.params);
      // Observed before anything changes (and only for a managed CLI): only the service's own
      // running daemon is restarted.
      const planServiceDaemonRestart = async (): Promise<ManagedCliUpdateRestart | null> => {
        const before = await deps.readDaemonStatus(target);
        // Unknown service shape grants no restart authority. Ownership and failure policy have
        // one owner shared with terminal self update.
        if (before.serviceTargetMode !== 'default-following' && before.serviceTargetMode !== 'pinned') return null;
        const service: ServiceDaemonBeforeCliUpdate<CliUpdateTarget> = {
          label: target.relayUrl ?? before.serviceServerId ?? 'default-following',
          serviceInstalled: before.serviceInstalled,
          daemonRunning: before.daemonRunning,
          serviceManaged: before.daemonServiceManaged,
          managedBy: before.serviceManagedBy,
          ...(before.serviceTargetMode === 'pinned' && before.serviceServerId ? {
            restartCommand: formatPinnedDaemonServiceRestartCommand({
              toolName: resolveCliInvokerNameForPublicRing(target.releaseRing ?? 'stable'),
              serverId: before.serviceServerId,
              instanceId: before.serviceServerId,
            }),
          } : {}),
          target,
        };
        return planServiceDaemonsRestartAfterCliUpdate({
          defaultFollowing: before.serviceTargetMode === 'default-following' ? service : null,
          pinned: before.serviceTargetMode === 'pinned' ? [service] : [],
          restartAndProve: async (restartTarget, expectedVersion) => {
            ctx.emit({ type: 'progress', stepId: 'cli.update.restartService', message: 'Restarting the background service' });
            await deps.restartService(restartTarget);
            const after = await deps.readDaemonStatus(restartTarget);
            if (!after.daemonRunning || after.daemonCliVersion !== expectedVersion) {
              throw new Error(`the background service runs ${after.daemonRunning ? after.daemonCliVersion ?? 'an unknown version' : 'no daemon'} instead of ${expectedVersion}`);
            }
          },
          reportUnownedRestartFailure: (message) => ctx.emit({ type: 'progress', stepId: 'cli.update.restartService', message }),
        }).restart;
      };
      ctx.emit({ type: 'progress', stepId: 'cli.update.install', message: 'Updating the Happier CLI' });
      const result = await deps.updateManagedCli({
        ...(target.releaseRing ? { releaseRing: target.releaseRing } : {}),
        signal: ctx.signal,
        onProgress: reportCliAcquisitionProgress(ctx.emit),
        planServiceDaemonRestart,
      });
      ctx.signal?.throwIfAborted();
      return { previousVersion: result.previousVersion, version: result.version, restarted: result.restarted };
    },
  };
}

export function createCliUpdateHandler(overrides: Partial<CliUpdateDeps> = {}) {
  return systemTasks.createExecutionRunnerFromKind(createCliUpdateTaskKind(overrides));
}
