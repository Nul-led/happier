import type { DaemonOwnerEvaluation } from '@/daemon/ownership/evaluateCurrentDaemonOwner';

export type DaemonServiceLifecycleCliAction = 'start' | 'stop' | 'restart';

/** The running daemon was started by this service definition (same label, service-managed). */
export function isRunningDaemonOwnedByService(params: Readonly<{
  ownership: DaemonOwnerEvaluation;
  expectedServiceLabel: string;
}>): boolean {
  if (params.ownership.kind === 'none') {
    return false;
  }
  const owner = params.ownership.owner;
  return owner.serviceManaged === true && owner.state.serviceLabel === params.expectedServiceLabel;
}

/**
 * This service's own daemon is running but is not compatible with the invoking CLI (it runs an
 * older/other version or channel). Starting an already-active unit is a no-op on systemd, so the
 * caller must replace it rather than wait for an ownership change that never happens.
 */
export function isRunningServiceDaemonStale(params: Readonly<{
  ownership: DaemonOwnerEvaluation;
  expectedServiceLabel: string;
}>): boolean {
  return params.ownership.kind === 'conflict' && isRunningDaemonOwnedByService(params);
}

/**
 * The one decision of which lifecycle command a `service start|stop|restart` invocation executes.
 * `start` becomes `restart` when the definition was just refreshed, when a running default-following
 * service must adopt the selected relay, or when this service's running daemon is stale.
 */
export function resolveDaemonServiceLifecycleAction(params: Readonly<{
  action: DaemonServiceLifecycleCliAction;
  ownership: DaemonOwnerEvaluation;
  expectedServiceLabel: string;
  refreshedInstalledServiceDefinition: boolean;
  runningDefaultFollowingServiceNeedsRelayRestart: boolean;
}>): DaemonServiceLifecycleCliAction {
  if (params.action !== 'start') {
    return params.action;
  }
  return params.refreshedInstalledServiceDefinition
    || params.runningDefaultFollowingServiceNeedsRelayRestart
    || isRunningServiceDaemonStale(params)
    ? 'restart'
    : 'start';
}
