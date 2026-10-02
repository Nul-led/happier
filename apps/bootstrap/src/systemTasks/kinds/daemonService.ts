import { systemTasks } from '@happier-dev/cli-common';
import { resolveHappyHomeDirFromEnvironment } from '@happier-dev/cli-common/agents';
import type { HappierService } from '@happier-dev/cli-common/happierRuntime';
import {
  DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
  readCurrentHappierServices,
  readAppManagedDaemonServices,
  resolveExplicitOrInstalledLocalFirstPartyCommand,
  type DaemonServiceKindDeps,
  type DaemonServiceServersKindDeps,
  type DaemonServiceStatusSnapshot,
  type DaemonServiceTaskParams,
  type InteractiveSystemTaskContext,
  type InteractiveSystemTaskKind,
} from '@happier-dev/cli-common/systemTasks';
import { normalizeBootstrapChannel } from '../taskRuntime.js';
import { reportCliAcquisitionProgress } from '../cliAcquisitionProgress.js';
import { disconnectRelayService, readDaemonStatus, readInstalledDaemonStatus, controlInstalledDaemonService, resolveAppManagedRelayService } from '../localDaemonCli.js';
import { describeUnservedCliChoiceFailure, readLocalHappierCliChoiceFacts } from '../happierCli.js';

function resolveReleaseRingFromChannel(channel: unknown) {
  const normalized = String(channel ?? '').trim();
  if (!normalized) return undefined;
  return normalizeBootstrapChannel(normalized).releaseChannel;
}

function resolveTarget(params: Readonly<{ channel?: unknown; relayUrl?: string; serverIdentityId?: string }>) {
  return {
    releaseRing: resolveReleaseRingFromChannel(params.channel),
    ...(params.relayUrl ? { relayUrl: params.relayUrl } : {}),
    ...(params.serverIdentityId ? { serverIdentityId: params.serverIdentityId } : {}),
  };
}

const daemonServiceServersDeps: DaemonServiceServersKindDeps = {
  resolveReleaseRing: (params) => resolveReleaseRingFromChannel(params.channel) ?? 'stable',
  hasLocalCli: (releaseRing) => resolveExplicitOrInstalledLocalFirstPartyCommand({
    componentId: 'happier-cli', processEnv: process.env, envVarNames: DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES, releaseRing,
  }) !== null,
  happierHomeDir: () => resolveHappyHomeDirFromEnvironment(process.env),
  readServices: readCurrentHappierServices,
  readStatus: async (target, context) => await readInstalledDaemonStatus({
    releaseRing: target.releaseRing, service: target.service, signal: context?.signal,
  }),
};

/** The status task reads the inventory once and consumes the plural producer's projection. */
export function createDaemonServiceStatusHandler() {
  return systemTasks.createExecutionRunnerFromKind({ run: readDaemonServiceTaskStatus });
}

async function readDaemonServiceTaskStatus(ctx: InteractiveSystemTaskContext) {
  const params = systemTasks.parseDaemonServiceTaskParams(ctx.params);
  const target = resolveTarget(params);
  let services: readonly HappierService[];
  try { services = await readCurrentHappierServices(); }
  catch (error) {
    if (isCancellation(error, ctx)) throw error;
    throw new systemTasks.SystemTaskExecutionError('service_inventory_unavailable', `This computer's background services could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  let status: DaemonServiceStatusSnapshot;
  try {
    status = await readDaemonStatus({
      ...target, signal: ctx.signal, onProgress: reportCliAcquisitionProgress(ctx.emit), readServices: async () => services,
    });
  } catch (error) {
    throw describeUnservedCliChoiceFailure(error, {
      ...(target.releaseRing ? { releaseRing: target.releaseRing } : {}), processEnv: process.env,
    }) ?? error;
  }
  const inventory = await systemTasks.readDaemonServiceInventory({ ...daemonServiceServersDeps, readServices: async () => services }, ctx);
  const managed = inventory.servers.filter((entry) => entry.appManaged);
  const managedModes = managed.map((entry) => entry.status?.serviceAutostart ?? null);
  const commonMode = managedModes.length > 0 && managedModes.every((mode) => mode !== null && mode === managedModes[0]) ? managedModes[0] : null;
  return {
    ...status,
    serviceAutostart: commonMode,
    managedServiceInstalled: managed.length > 0 ? true : inventory.serviceRowsComplete ? false : null,
    runningManagedServiceCount: managed.some((entry) => entry.status === null) ? null : managed.filter((entry) => entry.status?.daemonRunning).length,
    serviceRows: inventory.serviceRows, serviceRowsComplete: inventory.serviceRowsComplete,
    cliChoice: readLocalHappierCliChoiceFacts(process.env),
  };
}

function boundServiceDeps(service: HappierService, params: DaemonServiceTaskParams): DaemonServiceKindDeps {
  const target = { releaseRing: resolveReleaseRingFromChannel(params.channel), service };
  return {
    readStatus: async (_params, ctx) => await readInstalledDaemonStatus({ ...target, signal: ctx?.signal }),
    startService: async (_params, ctx) => await controlInstalledDaemonService({ ...target, action: 'start', signal: ctx?.signal }),
    stopService: async (_params, ctx) => await controlInstalledDaemonService({ ...target, action: 'stop', signal: ctx?.signal }),
    restartService: async (_params, ctx) => await controlInstalledDaemonService({ ...target, action: 'restart', signal: ctx?.signal }),
  };
}

const EMPTY_SERVICE_STATUS: DaemonServiceStatusSnapshot = {
  serviceInstalled: false, daemonRunning: false, needsAuth: true, machineId: null,
  daemonServerUrl: null, daemonComparableKey: null, daemonAccountId: null,
  daemonMachineRegistered: null, daemonAccountLabel: null, cliUpdate: null,
  serviceAutostart: null, serviceTargetMode: null, serviceManagedBy: null, serviceServerId: null,
};

type ServiceAction = 'start' | 'stop' | 'restart';
type ServiceKindFactory = (deps: DaemonServiceKindDeps, service: HappierService, params: DaemonServiceTaskParams) => InteractiveSystemTaskKind<DaemonServiceStatusSnapshot>;

function isCancellation(error: unknown, ctx: InteractiveSystemTaskContext) {
  return ctx.signal?.aborted || (error instanceof systemTasks.SystemTaskExecutionError && error.code === 'cancelled');
}

/** All controls bind installed identities and reuse the same shared lifecycle owner per target. */
function createManagedServiceHandler(action: ServiceAction | 'autostart', makeKind: ServiceKindFactory) {
  return systemTasks.createExecutionRunnerFromKind({
    async run(ctx) {
      const params = systemTasks.parseDaemonServiceTaskParams(ctx.params);
      ctx.signal?.throwIfAborted();
      if (action === 'autostart' && !params.autostart) throw new systemTasks.SystemTaskExecutionError('invalid_params', 'An explicit autostart mode is required.');
      const target = resolveTarget(params);
      let services: readonly HappierService[];
      if (target.relayUrl) {
        services = [await resolveAppManagedRelayService({ ...target, relayUrl: target.relayUrl, signal: ctx.signal })];
      } else {
        try {
          services = await readAppManagedDaemonServices({
            happierHomeDir: resolveHappyHomeDirFromEnvironment(process.env), releaseRing: target.releaseRing ?? 'stable',
          });
        } catch (error) {
          if (isCancellation(error, ctx)) throw error;
          throw new systemTasks.SystemTaskExecutionError('service_inventory_unavailable', `This computer's background services could not be read: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (services.length === 0) {
        if (action !== 'stop' && !(action === 'start' && params.onDemandOnly)) throw new systemTasks.SystemTaskExecutionError('daemon_service_not_installed', 'No managed background service is installed on this computer.');
        return { ...EMPTY_SERVICE_STATUS, managedServiceInstalled: false, runningManagedServiceCount: 0, serviceRows: [], serviceRowsComplete: true };
      }
      const failures: string[] = [];
      for (const service of services) {
        ctx.signal?.throwIfAborted();
        const deps = boundServiceDeps(service, params);
        try {
          if (action === 'start' && params.onDemandOnly) {
            const status = await deps.readStatus(params, ctx);
            if (status.serviceAutostart !== 'on-demand' || status.daemonRunning) {
              continue;
            }
          }
          await makeKind(deps, service, params).run(ctx);
        } catch (error) {
          if (isCancellation(error, ctx)) throw error;
          let message = error instanceof Error ? error.message : String(error);
          // A failed command may still have changed the service. Observe it before moving on.
          try {
            const observed = await deps.readStatus(params, ctx);
            const settled = action === 'stop' ? !observed.daemonRunning
              : action === 'autostart' ? observed.serviceInstalled && observed.serviceAutostart === params.autostart
                : observed.serviceInstalled && observed.daemonRunning && !observed.needsAuth;
            if (settled) continue;
          }
          catch (readError) {
            if (isCancellation(readError, ctx)) throw readError;
            message += `; status could not be read: ${readError instanceof Error ? readError.message : String(readError)}`;
          }
          failures.push(`${service.label}: ${message}`);
        }
      }
      if (failures.length > 0) throw new systemTasks.SystemTaskExecutionError('daemon_service_control_failed', `Background service ${action} failed: ${failures.join('; ')}`);
      return await readDaemonServiceTaskStatus(ctx);
    },
  });
}

export function createDaemonServiceStartHandler() {
  return createManagedServiceHandler('start', (deps) => systemTasks.createDaemonServiceStartTaskKind(deps));
}

export function createDaemonServiceStopHandler() {
  return createManagedServiceHandler('stop', (deps) => systemTasks.createDaemonServiceStopTaskKind(deps));
}

export function createDaemonServiceRestartHandler() {
  return createManagedServiceHandler('restart', (deps) => systemTasks.createDaemonServiceRestartTaskKind(deps));
}

export function createDaemonServiceAutostartSetHandler() {
  return createManagedServiceHandler('autostart', (deps, service, params) => systemTasks.createDaemonServiceAutostartTaskKind({
    ...deps,
    setAutostart: async (input, ctx) => await controlInstalledDaemonService({
      releaseRing: resolveReleaseRingFromChannel(params.channel), service, action: 'install', autostart: input.autostart, signal: ctx?.signal,
    }),
  }));
}

/** Relay removal remains an uninstall, separate from the tray's stop operation. */
export function createDaemonServiceRelayDisconnectHandler() {
  return systemTasks.createExecutionRunnerFromKind(systemTasks.createDaemonServiceRelayDisconnectTaskKind({
    disconnectRelayService: async (params, context) => await disconnectRelayService({
      ...resolveTarget(params), relayUrl: params.relayUrl, signal: context?.signal,
    }),
  }));
}
