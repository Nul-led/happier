import type { DaemonStartupSource } from '@/daemon/ownership/daemonOwnershipMetadata';
import type { CurrentDaemonOwner, DaemonOwnerEvaluation } from '@/daemon/ownership/evaluateCurrentDaemonOwner';
import { resolveDaemonServiceLaunchdLabel, type DaemonServiceTargetMode } from '@/daemon/service/plan';

export type DaemonTakeoverDecision =
  | Readonly<{ kind: 'ok' }>
  | Readonly<{ kind: 'conflict'; owner: CurrentDaemonOwner }>
  | Readonly<{ kind: 'manual-owner-takeover'; owner: CurrentDaemonOwner }>
  | Readonly<{ kind: 'manual-owner-replace'; owner: CurrentDaemonOwner }>
  /** A pinned service starting while the default-following daemon serves its server: stop it. */
  | Readonly<{ kind: 'default-following-owner-yield'; owner: CurrentDaemonOwner }>;

/** The service shape of this daemon's own background service (`HAPPIER_DAEMON_SERVICE_TARGET_MODE`). */
export function readStartingServiceTargetModeFromEnv(env: NodeJS.ProcessEnv = process.env): DaemonServiceTargetMode | null {
  const value = String(env.HAPPIER_DAEMON_SERVICE_TARGET_MODE ?? '').trim();
  return value === 'pinned' || value === 'default-following' ? value : null;
}

/**
 * One server has one owner, and its pinned background service is that owner (R10 D3). The
 * default-following service yields at its own startup when the pinned one is running
 * (`evaluateDefaultFollowingServiceStartup`); when the default one got the server's lock first —
 * both start at login, in no fixed order — the pinned one takes the server over here. The stopped
 * default daemon exits 0, which no service manager restarts, and yields at its next start.
 */
function isDefaultFollowingServiceOwnerYieldingToPinned(params: Readonly<{
  owner: CurrentDaemonOwner;
  startupSource: DaemonStartupSource;
  serviceTargetMode: DaemonServiceTargetMode | null;
}>): boolean {
  return params.serviceTargetMode === 'pinned'
    && (params.startupSource === 'background-service' || params.startupSource === 'self-restart')
    && params.owner.source === 'state'
    && params.owner.serviceManaged === true
    && params.owner.state.serviceLabel === resolveDaemonServiceLaunchdLabel('default', 'stable', 'default-following');
}

function canImplicitlyReplaceConflictingManualOwner(
  owner: CurrentDaemonOwner,
  startupSource: DaemonStartupSource,
): boolean {
  if (startupSource !== 'manual' && startupSource !== 'self-restart') {
    return false;
  }
  if (owner.serviceManaged === true) {
    return false;
  }
  if (owner.source === 'process') {
    return false;
  }

  return !owner.versionMatches || !owner.releaseChannelMatches;
}

export function resolveDaemonTakeoverDecision(params: Readonly<{
  ownership: DaemonOwnerEvaluation;
  takeoverRequested: boolean;
  startupSource: DaemonStartupSource;
  /** The starting daemon's own service shape; `null`/absent for any daemon a service did not start. */
  serviceTargetMode?: DaemonServiceTargetMode | null;
}>): DaemonTakeoverDecision {
  if (params.ownership.kind !== 'none' && isDefaultFollowingServiceOwnerYieldingToPinned({
    owner: params.ownership.owner,
    startupSource: params.startupSource,
    serviceTargetMode: params.serviceTargetMode ?? null,
  })) {
    return { kind: 'default-following-owner-yield', owner: params.ownership.owner };
  }
  if (params.ownership.kind === 'none' || params.ownership.kind === 'compatible') {
    return { kind: 'ok' };
  }

  if (params.takeoverRequested && params.ownership.owner.serviceManaged !== true) {
    return { kind: 'manual-owner-takeover', owner: params.ownership.owner };
  }

  if (canImplicitlyReplaceConflictingManualOwner(params.ownership.owner, params.startupSource)) {
    return { kind: 'manual-owner-replace', owner: params.ownership.owner };
  }

  return { kind: 'conflict', owner: params.ownership.owner };
}

function describeTakeoverAction(action: 'start' | 'start-sync' | 'restart'): string {
  if (action === 'start') {
    return 'start the daemon';
  }
  if (action === 'start-sync') {
    return 'start the daemon synchronously';
  }
  return 'restart the daemon';
}

export function buildDaemonTakeoverHint(params: Readonly<{
  commandPath: string;
  action: 'start' | 'start-sync' | 'restart';
}>): string {
  return `Re-run with \`${params.commandPath} ${params.action} --takeover\` if you want to stop the current manual relay runtime and ${describeTakeoverAction(params.action)}.`;
}

export function buildDaemonTakeoverNotice(params: Readonly<{
  action: 'start' | 'start-sync' | 'restart';
}>): Readonly<{ title: string; lines: readonly string[] }> {
  return {
    title: 'Taking over the current manual relay runtime.',
    lines: [
      `Happier will stop the current manual relay runtime before it ${params.action === 'start'
        ? 'starts the daemon'
        : params.action === 'start-sync'
          ? 'starts the daemon synchronously'
          : 'restarts the daemon'}.`,
    ],
  };
}
