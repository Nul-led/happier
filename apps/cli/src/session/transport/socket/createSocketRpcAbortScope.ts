import type { Socket } from 'socket.io-client';

export type SocketRpcAbortScope = Readonly<{
  signal: AbortSignal;
  dispose(): void;
}>;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

/**
 * Observes caller cancellation and socket loss from before connection starts
 * until the RPC acknowledgement settles.
 */
export function createSocketRpcAbortScope(params: Readonly<{
  socket: Socket;
  callerSignal?: AbortSignal;
  disconnectError: () => Error;
}>): SocketRpcAbortScope {
  const controller = new AbortController();
  let disposed = false;
  const onCallerAbort = () => {
    if (params.callerSignal) abort(abortReason(params.callerSignal));
  };
  const onDisconnect = () => abort(params.disconnectError());
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    params.socket.off('disconnect', onDisconnect);
    params.callerSignal?.removeEventListener('abort', onCallerAbort);
  };
  const abort = (reason: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    dispose();
  };

  params.socket.on('disconnect', onDisconnect);
  params.callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  if (params.callerSignal?.aborted) onCallerAbort();

  return Object.freeze({ signal: controller.signal, dispose });
}
