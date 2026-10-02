import { UpdateContainerSchema } from '@happier-dev/protocol/updates';
import { observeSessionSocketEvents } from '@/session/transport/socket/sessionSocketAgentState';
import { resolveServerHttpBaseUrl } from './client/serverHttpBaseUrl';

/**
 * Demand-scoped observation over the incumbent Home socket. The wake is content-free;
 * readers fetch their exact durable facts. Reconnect invalidates those facts as well,
 * catching up missed writes without a second cursor or domain event stream.
 */
export function observeAccountChanges(
  opts: Readonly<{ token: string; serverUrl?: string; entityId?: string }>,
  handlers: Readonly<{ onChange: () => void; onError: (error: unknown) => void }>,
): Readonly<{ dispose(): Promise<void> }> {
  return observeSessionSocketEvents({ token: opts.token, serverUrl: opts.serverUrl ?? resolveServerHttpBaseUrl(), scope: 'user' }, {
    onConnected: handlers.onChange,
    onError: handlers.onError,
    onUpdate: (value) => {
      const parsed = UpdateContainerSchema.safeParse(value);
      if (!parsed.success) return;
      const body = parsed.data.body;
      if (body.t === 'account-change') handlers.onChange();
      else if ((body.t === 'new-artifact' || body.t === 'update-artifact' || body.t === 'delete-artifact')
        && (opts.entityId === undefined || body.artifactId === opts.entityId)) handlers.onChange();
    },
  });
}
