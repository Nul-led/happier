import { classifyRelayDrift, createRelayUrlComparableKeySafe, resolveThisComputerServiceState } from '@happier-dev/protocol/server/relayDrift';
import { type PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import type { HappierService } from '../../happierRuntime/types.js';
import {
  isAppManagedDaemonService,
  isInstalledDaemonServiceOfHappierHomeAndRing,
  selectServingDaemonService,
} from '../executors/serverScope.js';
import { SystemTaskExecutionError } from '../runSystemTask.js';
import type { InteractiveSystemTaskContext } from '../interactiveTaskKinds.js';
import {
  parseDaemonServiceTaskParams,
  readDaemonServiceStartBlocker,
  type DaemonServiceStatusSnapshot,
  type DaemonServiceTaskParams,
} from './daemonServiceKinds.js';

/** One of this computer's background services and the daemon it runs. */
export type DaemonServiceServerEntry = Readonly<{
  /** A pin's expected relay, or the default-following daemon's observed relay. */
  serverUrl: string | null;
  label: string;
  targetMode: 'pinned' | 'default-following';
  /** `desktop` when the desktop app manages the service; `null` when the user installed it. */
  managedBy: 'desktop' | null;
  appManaged: boolean;
  /** This service wins the installed pin/default selection for the relay it reports. */
  serving: boolean;
  /** Its own daemon's status; `null` when it could not be read (never "connected"). */
  status: DaemonServiceStatusSnapshot | null;
}>;

export type ThisComputerServiceRow = Readonly<{
  relayUrl: string;
  state: 'connected' | 'offline' | 'needs_attention';
  appManaged: boolean;
  serviceTargetMode: 'pinned' | 'default-following';
  actions: readonly ('start' | 'restart' | 'stop')[];
  /** Known only when the consuming app can see this service's machine/account sessions. */
  activeSessionCount?: number;
}>;

export type DaemonServiceServersResult = Readonly<{
  servers: readonly DaemonServiceServerEntry[];
  serviceRows: readonly ThisComputerServiceRow[];
  serviceRowsComplete: boolean;
}>;

export type DaemonServiceServersKindDeps = Readonly<{
  resolveReleaseRing: (params: DaemonServiceTaskParams) => PublicReleaseRingId;
  /** Whether a CLI is already on this computer; this read never acquires one. */
  hasLocalCli: (releaseRing: PublicReleaseRingId) => boolean;
  happierHomeDir: () => string | null;
  readServices: () => Promise<readonly HappierService[]>;
  /** One service's own daemon: scoped to `relayUrl` for a pinned service, unscoped for the default one. */
  readStatus: (
    target: Readonly<{ releaseRing: PublicReleaseRingId; service: HappierService; relayUrl?: string }>,
    context?: Pick<InteractiveSystemTaskContext, 'signal'>,
  ) => Promise<DaemonServiceStatusSnapshot>;
}>;

function selectServingEntries(entries: readonly DaemonServiceServerEntry[]): Set<DaemonServiceServerEntry> {
  const byRelay = new Map<string, DaemonServiceServerEntry[]>();
  for (const entry of entries) {
    const key = createRelayUrlComparableKeySafe(entry.serverUrl);
    if (!key) continue;
    const candidates = byRelay.get(key) ?? [];
    candidates.push(entry);
    byRelay.set(key, candidates);
  }
  return new Set([...byRelay.values()].flatMap((candidates) => {
    const serving = selectServingDaemonService(candidates);
    return serving ? [serving] : [];
  }));
}

/** Shared CLI/system-task projection. The UI re-judges only its active Home's account. */
function projectServiceRows(
  servers: readonly DaemonServiceServerEntry[],
): Pick<DaemonServiceServersResult, 'serviceRows' | 'serviceRowsComplete'> {
  const serviceRows = servers.flatMap((entry): ThisComputerServiceRow[] => {
    if (!entry.serving || !entry.serverUrl) return [];
    const status = entry.status;
    const drift = status ? classifyRelayDrift({
      activeRelayUrl: entry.serverUrl,
      daemonRelayUrl: status.daemonServerUrl,
      daemonAccountId: status.daemonAccountId,
      daemonNeedsAuth: status.needsAuth,
      daemonServiceInstalled: status.serviceInstalled,
      daemonRunning: status.daemonRunning,
    }).status : null;
    const state = drift === null ? 'needs_attention' : resolveThisComputerServiceState(drift);
    return [{
      relayUrl: entry.serverUrl,
      state,
      appManaged: entry.appManaged,
      serviceTargetMode: entry.targetMode,
      actions: entry.appManaged && status?.serviceInstalled ? status.daemonRunning ? ['restart', 'stop'] : readDaemonServiceStartBlocker(status) === null ? ['start'] : [] : [],
    }];
  });
  return {
    serviceRows,
    serviceRowsComplete: servers.every((entry) => entry.status !== null && createRelayUrlComparableKeySafe(entry.serverUrl) !== null),
  };
}

/**
 * Status inventory: every server this computer serves — one daemon per server —
 * as the daemon services of this Happier home and ring, each with its own daemon's status. A
 * service whose status cannot be read stays listed as unreadable. The installed pin wins over
 * the default for the same relay; every entry stays visible in the inventory, with one serving
 * designation and one row per comparable relay. Read-only; this never acquires a CLI.
 */
export async function readDaemonServiceInventory(
  deps: DaemonServiceServersKindDeps,
  ctx: InteractiveSystemTaskContext,
): Promise<DaemonServiceServersResult> {
      const params = parseDaemonServiceTaskParams(ctx.params);
      const releaseRing = deps.resolveReleaseRing(params);
      if (!deps.hasLocalCli(releaseRing)) return { servers: [], serviceRows: [], serviceRowsComplete: true };
      const happierHomeDir = deps.happierHomeDir();
      const services = (await deps.readServices()).filter((service) =>
        isInstalledDaemonServiceOfHappierHomeAndRing(service, { happierHomeDir, releaseRing }));

      const entries = await Promise.all(services.map(async (service): Promise<DaemonServiceServerEntry> => {
        const targetMode = service.targetMode === 'default-following' ? 'default-following' : 'pinned';
        const definitionUrl = service.publicServerUrl ?? service.serverUrl ?? null;
        const relayUrl = targetMode === 'pinned' ? definitionUrl : null;
        const status = service.verification !== 'verified' || (targetMode === 'pinned' && !relayUrl) ? null : await deps.readStatus(
          { releaseRing, service, ...(relayUrl ? { relayUrl } : {}) },
          { signal: ctx.signal },
        ).catch((error: unknown) => {
          if (ctx.signal?.aborted || (error instanceof SystemTaskExecutionError && error.code === 'cancelled')) throw error;
          return null;
        });
        return {
          serverUrl: targetMode === 'pinned' ? definitionUrl ?? status?.daemonServerUrl ?? null : status?.daemonServerUrl ?? definitionUrl,
          label: service.label,
          targetMode,
          managedBy: service.verification === 'verified' && service.managedBy === 'desktop' ? 'desktop' : null,
          appManaged: isAppManagedDaemonService(service),
          serving: false,
          status,
        };
      }));

      const selected = selectServingEntries(entries);
      const servers = entries
        .map((entry) => ({ ...entry, serving: selected.has(entry) }))
        .sort((left, right) => left.label.localeCompare(right.label));
      return { servers, ...projectServiceRows(servers) };
}
