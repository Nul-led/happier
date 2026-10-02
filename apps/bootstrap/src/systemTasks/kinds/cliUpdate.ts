import { systemTasks } from '@happier-dev/cli-common';
import {
  formatPinnedDaemonServiceRestartCommand,
  planServiceDaemonsRestartAfterCliUpdate,
  resolveManagedCliToolNameForRing,
  type ServiceDaemonBeforeCliUpdate,
} from '@happier-dev/cli-common/firstPartyRuntime';

import { reportCliAcquisitionProgress } from '../cliAcquisitionProgress.js';
import { resolveLocalHappierCliReleaseRing, updateManagedLocalHappierCli } from '../happierCli.js';
import {
  controlDaemonService,
  createSelectedCliInvocation,
  readDaemonStatus,
  readPinnedDaemonServices,
  type DaemonStatusSnapshot,
  type LocalHappierCliInvocation,
} from '../localDaemonCli.js';
import { parseBootstrapChannelParam } from './daemonService.js';

export type CliUpdateTaskResult = Readonly<{
  previousVersion: string;
  version: string;
  /** Whether the service daemon was running and was restarted onto (and proved to run) the new version. */
  restarted: boolean;
}>;

function parseCliUpdateParams(params: unknown) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new systemTasks.SystemTaskExecutionError('invalid_params', 'CLI update params must be an object.');
  }
  return { releaseRing: parseBootstrapChannelParam((params as Record<string, unknown>).channel) };
}

/** One service as the CLI reports it before the update, for the shared restart rule. */
function observeService(
  label: string,
  status: DaemonStatusSnapshot,
  invocation: LocalHappierCliInvocation,
  managedBy: 'desktop' | null = null,
  restartCommand?: string,
): ServiceDaemonBeforeCliUpdate<LocalHappierCliInvocation> {
  return {
    label,
    managedBy,
    ...(restartCommand ? { restartCommand } : {}),
    serviceInstalled: status.service.installed,
    daemonRunning: status.daemon.running,
    serviceManaged: status.daemon.serviceManaged === true,
    target: invocation,
  };
}

/**
 * `cli.update.v1` — the desktop's one "Update" action (plan R17/K2, R13 f). Runs the one CLI update
 * transaction on this computer's managed CLI (same progress events as a first acquisition). When
 * this computer's background service is running its daemon, the transaction restarts it through
 * the CLI service owner and proves it runs the new version; if that is not proven, every piece of
 * activation state is restored and the previous version restarted, and the task fails
 * `cli_update_rolled_back`. A daemon that was not running is not started, and a manual daemon is
 * not the service's to restart.
 *
 * Status reads and the restart run with the inherited relay selectors cleared (R13 a): they answer
 * for the relay this home's persisted selection names, which is what the background service
 * serves, so the daemon verified is the daemon restarted even under a stack-pinned launch.
 *
 * One daemon per relay: each pinned service of this home and ring runs the same managed CLI, so
 * each one whose daemon runs is restarted and proven the same way, addressed to that service —
 * through `planServiceDaemonsRestartAfterCliUpdate`, the rule `happier self update` also uses. Every
 * daemon is attempted before a failure is reported. A CLI that cannot list its services leaves
 * only the default-following service in the plan.
 */
export function createCliUpdateHandler() {
  return async function* (
    params: unknown,
    context: Readonly<{ signal: AbortSignal; emit?: (event: unknown) => void }>,
  ): AsyncGenerator<never, CliUpdateTaskResult, void> {
    const { releaseRing } = parseCliUpdateParams(params);
    const onProgress = context.emit ? reportCliAcquisitionProgress(context.emit) : undefined;
    const { previousVersion, cli, restarted } = await updateManagedLocalHappierCli({
      releaseRing,
      signal: context.signal,
      onProgress,
      planRestart: async (current) => {
        const service = createSelectedCliInvocation({ cli: current, processEnv: process.env });
        const [status, pinned] = await Promise.all([
          readDaemonStatus(releaseRing, service),
          readPinnedDaemonServices(releaseRing, service),
        ]);
        // M6 — an incomplete inventory is not "no pinned daemons": the relays whose service could
        // not be read (or a list the CLI could not give) are named on the run's own event stream,
        // since those daemons keep the previous CLI until their next restart.
        if (!pinned.complete) {
          const unreadable = pinned.items.filter((item) => item.status === null).map((item) => item.service.relayUrl);
          context.emit?.({
            type: 'progress',
            stepId: 'cli.update.restartServices',
            message: unreadable.length > 0
              ? `Could not read the background services for ${unreadable.join(', ')}; they keep running the previous version until they restart.`
              : 'Could not list this computer\'s other background services; any of them keeps running the previous version until it restarts.',
          });
        }
        // Which daemons come back is the shared rule `happier self update` uses too.
        return planServiceDaemonsRestartAfterCliUpdate({
          defaultFollowing: observeService('default', status, service),
          // A pinned service whose status could not be read is not known to run a daemon; the
          // desktop update stops no daemon, so it keeps running (and self-restarts on version drift).
          pinned: pinned.items.flatMap((item) => item.status
            ? [observeService(item.service.instanceId, item.status, item.invocation, item.service.managedBy, formatPinnedDaemonServiceRestartCommand({
              // The update runs only on a managed CLI, whose command is its ring's.
              toolName: resolveManagedCliToolNameForRing(resolveLocalHappierCliReleaseRing({ appRing: releaseRing, processEnv: process.env })),
              serverId: item.service.activeServerId,
              instanceId: item.service.instanceId,
            }))]
            : []),
          // The update owner checks cancellation before activation. Once activated, its restart
          // and possible restore must settle before reporting cancellation, not race a rollback.
          restartAndProve: async (invocation, expectedVersion) => {
            await controlDaemonService(releaseRing, { action: 'restart', takeover: false }, invocation);
            const restartedStatus = await readDaemonStatus(releaseRing, invocation);
            const runningVersion = restartedStatus.daemon.startedWithCliVersion;
            if (!restartedStatus.daemon.running || runningVersion !== expectedVersion) {
              throw new Error(`the background service runs ${runningVersion ?? 'no daemon'} instead of ${expectedVersion}`);
            }
          },
          // A service the user installed is restarted too, but it never rolls the desktop's update back.
          reportUnownedRestartFailure: (message) => {
            context.emit?.({ type: 'progress', stepId: 'cli.update.restartServices', message });
          },
        }).restart;
      },
    });
    context.signal.throwIfAborted();
    return { previousVersion, version: cli.version, restarted };
  };
}
