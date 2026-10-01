import type { HappierHomeServiceDisconnect } from '../executors/serverScope.js';
import { type InteractiveSystemTaskContext, type InteractiveSystemTaskKind } from '../interactiveTaskKinds.js';
import { SystemTaskExecutionError } from '../runSystemTask.js';
import { parseDaemonServiceTaskParams, type DaemonServiceTaskParams } from './daemonServiceKinds.js';

export type DaemonServiceRelayDisconnectDeps = Readonly<{
  disconnectRelayService: (
    params: DaemonServiceTaskParams & Readonly<{ relayUrl: string }>,
    context?: Pick<InteractiveSystemTaskContext, 'signal'>,
  ) => Promise<HappierHomeServiceDisconnect>;
}>;

/**
 * `daemon.service.relay.disconnect.v1` (R15): before the app forgets a Home, this computer stops
 * serving it — its desktop-managed pinned service is uninstalled (`disconnectHappierHomeService`).
 * The Home is named by `relayUrl` (and its identity, when known); a service the user installed is
 * reported `user_owned` and left alone.
 */
export function createDaemonServiceRelayDisconnectTaskKind(
  deps: DaemonServiceRelayDisconnectDeps,
): InteractiveSystemTaskKind<HappierHomeServiceDisconnect> {
  return {
    async run(ctx) {
      const parsed = parseDaemonServiceTaskParams(ctx.params);
      if (!parsed.relayUrl) {
        throw new SystemTaskExecutionError('invalid_params', 'relayUrl is required to disconnect this computer from a Home.');
      }
      return await deps.disconnectRelayService({ ...parsed, relayUrl: parsed.relayUrl }, ctx);
    },
  };
}
