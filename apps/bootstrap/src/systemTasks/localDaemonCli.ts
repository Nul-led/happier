import { systemTasks } from '@happier-dev/cli-common';
import type { FirstPartyAcquisitionOptions } from '@happier-dev/cli-common/firstPartyRuntime';
import type { HappierService } from '@happier-dev/cli-common/happierRuntime';
import { resolveHappyHomeDirFromEnvironment } from '@happier-dev/cli-common/agents';
import {
  createLocalHappierJsonExecutor,
  DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
  disconnectHappierHomeService,
  readLocalCliUpdateFact,
  readCurrentHappierServices,
  isInstalledDaemonServiceOfHappierHomeAndRing,
  resolveExplicitOrInstalledLocalFirstPartyCommand,
  type HappierHomeServiceDisconnect,
  readLocalServerProfileScope,
  scopeHappierJsonExecutor,
  type HappierJsonExecutor,
  type LocalCliUpdateFact,
} from '@happier-dev/cli-common/systemTasks';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

export type DaemonStatusSnapshot = Readonly<{
  serviceAutostart: 'at-login' | 'on-demand' | null;
  serviceTargetMode: 'default-following' | 'pinned' | null;
  serviceManagedBy: 'desktop' | null;
  serviceServerId: string | null;
  serviceInstalled: boolean;
  daemonRunning: boolean;
  needsAuth: boolean;
  machineId: string | null;
  daemonServerUrl: string | null;
  daemonComparableKey: string | null;
  daemonAccountId: string | null;
  daemonMachineRegistered: boolean | null;
  daemonAccountLabel: string | null;
  /** Whether the running daemon was started by its background service (`null` when unknown). */
  daemonServiceManaged: boolean | null;
  /** The CLI version the running daemon started with — the update transaction's restart proof. */
  daemonCliVersion: string | null;
  cliUpdate: LocalCliUpdateFact | null;
}>;

type LocalDaemonCliOptions = FirstPartyAcquisitionOptions & Readonly<{
  releaseRing?: PublicReleaseRingId;
  /** The Home whose own daemon/service to address; absent reads the CLI's active server. */
  relayUrl?: string;
  /** That Home's server identity, which tells apart CLI profiles sharing its URL (RV-11). */
  serverIdentityId?: string;
  readServices?: () => Promise<readonly HappierService[]>;
}>;

/** A Home the CLI has no saved profile for has no daemon or service of its own yet. */
const NO_HOME_DAEMON_STATUS = {
  serviceAutostart: null,
  serviceTargetMode: null,
  serviceManagedBy: null,
  serviceServerId: null,
  serviceInstalled: false,
  daemonRunning: false,
  needsAuth: true,
  machineId: null,
  daemonServerUrl: null,
  daemonComparableKey: null,
  daemonAccountId: null,
  daemonMachineRegistered: null,
  daemonAccountLabel: null,
  daemonServiceManaged: null,
  daemonCliVersion: null,
} as const;

/**
 * The executor for one explicit Home: scoped to its saved profile and its own service shape
 * (R10 D3), or `null` when the CLI has never been set up for that Home.
 */
async function createHomeScopedExecutor(
  options: LocalDaemonCliOptions & Readonly<{ relayUrl: string; onCommandReady?: () => void; requireAppManaged?: boolean }>,
): Promise<Readonly<{ executor: HappierJsonExecutor; service: HappierService | null }> | null> {
  const executor = createLocalHappierJsonExecutor({
    releaseRing: options.releaseRing,
    signal: options.signal,
    onProgress: options.onProgress,
    onCommandReady: options.onCommandReady,
  });
  const scope = await readLocalServerProfileScope(scopeHappierJsonExecutor(executor, { serverId: null, targetMode: 'default-following' }), {
    serverUrl: options.relayUrl,
    localServerUrl: options.relayUrl,
    serverIdentityId: options.serverIdentityId ?? null,
  }, { releaseRing: options.releaseRing, requireAppManaged: options.requireAppManaged, readServices: options.readServices });
  if (!scope.serverId) return null;
  return { executor: scopeHappierJsonExecutor(executor, { serverId: scope.serverId, targetMode: scope.targetMode }), service: scope.selectedService };
}

async function runScopedLocalHappierJsonCommand(
  args: readonly string[],
  options: LocalDaemonCliOptions & Readonly<{ allowJsonFailure?: boolean; onCommandReady?: () => void }> = {},
): Promise<unknown> {
  if (options.relayUrl) {
    const scoped = await createHomeScopedExecutor({ ...options, relayUrl: options.relayUrl });
    if (!scoped) {
      throw new systemTasks.SystemTaskExecutionError(
        'daemon_service_not_installed',
        'This Home has no background service on this computer yet.',
      );
    }
    return await scoped.executor.runHappierJson(args, {
      ...(typeof options.allowJsonFailure === 'boolean' ? { allowJsonFailure: options.allowJsonFailure } : {}),
    });
  }
  const executor = scopeHappierJsonExecutor(createLocalHappierJsonExecutor({
    releaseRing: options.releaseRing,
    signal: options.signal,
    onProgress: options.onProgress,
    onCommandReady: options.onCommandReady,
  }), { serverId: null, targetMode: 'default-following' });
  return await executor.runHappierJson(args, {
    ...(typeof options.allowJsonFailure === 'boolean' ? { allowJsonFailure: options.allowJsonFailure } : {}),
  });
}

export async function restartService(options: LocalDaemonCliOptions = {}): Promise<void> {
  await runScopedLocalHappierJsonCommand(['service', 'restart', '--json'], options);
}

export async function readDaemonStatus(options: LocalDaemonCliOptions = {}): Promise<DaemonStatusSnapshot> {
  const onCommandReady = () => options.onProgress?.({ phase: 'checkingDaemon' });
  const readCliUpdate = () => readLocalCliUpdateFact({ ...(options.releaseRing ? { releaseRing: options.releaseRing } : {}) });
  let parsed: unknown;
  let selectedService: HappierService | null = null;
  if (options.relayUrl) {
    const scoped = await createHomeScopedExecutor({ ...options, relayUrl: options.relayUrl, onCommandReady });
    if (!scoped) {
      return { ...NO_HOME_DAEMON_STATUS, cliUpdate: readCliUpdate() };
    }
    selectedService = scoped.service;
    parsed = await scoped.executor.runHappierJson(['daemon', 'status', '--json']);
  } else {
    parsed = await runScopedLocalHappierJsonCommand(['daemon', 'status', '--json'], {
      ...options,
      onCommandReady,
    });
    selectedService = (await (options.readServices ?? readCurrentHappierServices)()).find((service) =>
      service.targetMode === 'default-following' && isInstalledDaemonServiceOfHappierHomeAndRing(service, {
        happierHomeDir: resolveHappyHomeDirFromEnvironment(process.env), releaseRing: options.releaseRing,
      })) ?? null;
  }
  return parseDaemonStatus(parsed, selectedService, readCliUpdate());
}

function parseDaemonStatus(parsed: unknown, selectedService: HappierService | null, cliUpdate: LocalCliUpdateFact | null): DaemonStatusSnapshot {
  if (!parsed || typeof parsed !== 'object') {
    throw new systemTasks.SystemTaskExecutionError(
      'invalid_cli_response',
      'Received an invalid daemon status response.',
    );
  }

  const record = parsed as {
    daemon?: { running?: unknown; serviceManaged?: unknown; startedWithCliVersion?: unknown };
    service?: { installed?: unknown; autostart?: unknown };
    server?: { serverUrl?: unknown; comparableKey?: unknown };
    auth?: {
      needsAuth?: unknown;
      machineId?: unknown;
      accountId?: unknown;
      accountLabel?: unknown;
      machineRegistered?: unknown;
    };
  };

  return {
    serviceAutostart: record.service?.autostart === 'at-login' || record.service?.autostart === 'on-demand' ? record.service.autostart : null,
    serviceTargetMode: selectedService?.verification === 'verified' ? selectedService.targetMode ?? null : null,
    serviceManagedBy: selectedService?.verification === 'verified' && selectedService.managedBy === 'desktop' ? 'desktop' : null,
    serviceServerId: selectedService?.verification === 'verified' && selectedService.targetMode === 'pinned' ? selectedService.instanceId : null,
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
    daemonAccountLabel: typeof record.auth?.accountLabel === 'string' && record.auth.accountLabel.trim()
      ? record.auth.accountLabel.trim()
      : null,
    daemonServiceManaged: typeof record.daemon?.serviceManaged === 'boolean' ? record.daemon.serviceManaged : null,
    daemonCliVersion: typeof record.daemon?.startedWithCliVersion === 'string' && record.daemon.startedWithCliVersion.trim()
      ? record.daemon.startedWithCliVersion.trim()
      : null,
    cliUpdate,
  };
}

/** Reads the discovered service itself; no URL lookup or second inventory decides its scope. */
export async function readInstalledDaemonStatus(options: LocalDaemonCliOptions & Readonly<{ service: HappierService }>): Promise<DaemonStatusSnapshot> {
  const scoped = createInstalledServiceExecutor(options);
  const parsed = await scoped.runHappierJson(['daemon', 'status', '--json']);
  return parseDaemonStatus(parsed, options.service, readLocalCliUpdateFact({ ...(options.releaseRing ? { releaseRing: options.releaseRing } : {}) }));
}

function createInstalledServiceExecutor(options: LocalDaemonCliOptions & Readonly<{ service: HappierService }>): HappierJsonExecutor {
  const service = options.service;
  const serverId = service.instanceId;
  const executor = createLocalHappierJsonExecutor({ releaseRing: options.releaseRing, signal: options.signal, onProgress: options.onProgress });
  if (service.targetMode === 'default-following') return scopeHappierJsonExecutor(executor, { serverId: null, targetMode: 'default-following' });
  if (service.targetMode !== 'pinned' || !serverId) {
    throw new systemTasks.SystemTaskExecutionError('service_ownership_unverified', `Background service ${service.label} has no verified instance.`);
  }
  return scopeHappierJsonExecutor(executor, { serverId, targetMode: 'pinned' });
}

export async function controlInstalledDaemonService(options: LocalDaemonCliOptions & Readonly<{ service: HappierService; action: 'start' | 'stop' | 'restart' | 'install'; autostart?: 'at-login' | 'on-demand' }>): Promise<void> {
  await createInstalledServiceExecutor(options).runHappierJson(['service', options.action, ...(options.autostart ? [`--autostart=${options.autostart}`] : []), '--json']);
}

/** Resolves the installed serving target and enforces ownership before any control command. */
export async function resolveAppManagedRelayService(options: LocalDaemonCliOptions & Readonly<{ relayUrl: string }>): Promise<HappierService> {
  const scoped = await createHomeScopedExecutor({ ...options, requireAppManaged: true });
  if (!scoped?.service) throw new systemTasks.SystemTaskExecutionError('daemon_service_not_installed', 'This Home has no installed background service.');
  return scoped.service;
}

/**
 * R15: this computer stops serving a Home the app is forgetting — its desktop-managed pinned service
 * is uninstalled through the CLI's service owner. Never acquires a CLI: with no local Happier CLI
 * there is no service of it to remove.
 */
export async function disconnectRelayService(
  options: LocalDaemonCliOptions & Readonly<{ relayUrl: string }>,
): Promise<HappierHomeServiceDisconnect> {
  const resolved = resolveExplicitOrInstalledLocalFirstPartyCommand({
    componentId: 'happier-cli',
    processEnv: process.env,
    envVarNames: DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
    ...(options.releaseRing ? { releaseRing: options.releaseRing } : {}),
  });
  if (!resolved) return { outcome: 'no_service', label: null };
  return await disconnectHappierHomeService({
    executor: createLocalHappierJsonExecutor({ releaseRing: options.releaseRing, signal: options.signal }),
    target: {
      serverUrl: options.relayUrl,
      localServerUrl: options.relayUrl,
      serverIdentityId: options.serverIdentityId ?? null,
    },
    releaseRing: options.releaseRing ?? 'stable',
  });
}
