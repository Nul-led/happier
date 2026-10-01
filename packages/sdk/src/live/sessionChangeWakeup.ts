import { UpdateContainerSchema } from '@happier-dev/protocol/updates';
import type { HappierSocket } from '@happier-dev/sync-client';

/** Coalesced invalidation only: pushed ciphertext never enters the Action read model. */
export function createSessionChangeWakeup(socket: HappierSocket | null, sessionId: string, signal: AbortSignal) {
  let pending = false;
  let waiting: (() => void) | undefined;
  const wake = () => {
    pending = true;
    waiting?.();
  };
  const update = (value: unknown) => {
    const parsed = UpdateContainerSchema.safeParse(value);
    if (!parsed.success) return;
    const body = parsed.data.body;
    if ((body.t === 'new-message' || body.t === 'message-updated') && body.sid === sessionId
      || body.t === 'update-session' && body.id === sessionId) wake();
  };
  let detach: (() => void) | undefined;
  const observeSocket = (next: HappierSocket) => {
    detach?.();
    next.on('update', update);
    detach = () => next.off('update', update);
  };
  if (socket) observeSocket(socket);
  const dispose = () => {
    detach?.();
    detach = undefined;
    waiting?.();
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return {
    wake,
    observeSocket,
    async wait() {
      if (!pending && !signal.aborted) await new Promise<void>((resolve) => { waiting = resolve; });
      waiting = undefined;
      pending = false;
      signal.throwIfAborted();
    },
    dispose,
  };
}
