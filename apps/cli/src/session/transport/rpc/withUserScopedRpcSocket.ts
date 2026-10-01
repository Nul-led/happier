import { createUserScopedSocketConnection } from '@/api/session/sockets';
import { markRpcRequestDisposition, readRpcRequestDisposition } from '@happier-dev/sync-client';

type RpcSocket = ReturnType<typeof createUserScopedSocketConnection>['socket'];

/** CLI-owned one-shot lifetime; transport connection and RPC policy stay shared. */
export async function withUserScopedRpcSocket<R>(
  params: Readonly<{
    token: string;
    serverUrl?: string;
    connectTimeoutMs: number;
    signal?: AbortSignal;
    disconnectMessage: string;
  }>,
  run: (socket: RpcSocket, connect: () => Promise<void>) => Promise<R>,
): Promise<R> {
  params.signal?.throwIfAborted();
  const connection = createUserScopedSocketConnection(params);
  const connect = async () => {
    params.signal?.throwIfAborted();
    let onAbort = () => {};
    let unsubscribe = () => {};
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(params.signal?.reason ?? Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      params.signal?.addEventListener('abort', onAbort, { once: true });
      unsubscribe = connection.transport.onDisconnected(() => reject(new Error(params.disconnectMessage)));
    });
    try {
      // Prefer a lifecycle failure if a synchronous connection immediately disconnects.
      await Promise.race([stopped, connection.transport.connect()]);
      if (connection.socket.connected === false) throw new Error(params.disconnectMessage);
      params.signal?.throwIfAborted();
    } finally {
      params.signal?.removeEventListener('abort', onAbort);
      unsubscribe();
    }
  };
  try {
    return await run(connection.socket, connect);
  } catch (error) {
    throw readRpcRequestDisposition(error) === null ? markRpcRequestDisposition(error, 'notSent') : error;
  } finally {
    try { await connection.transport.destroy(); } catch { /* Preserve the RPC result. */ }
    try { connection.socket.close(); } catch { /* Preserve the RPC result. */ }
  }
}
