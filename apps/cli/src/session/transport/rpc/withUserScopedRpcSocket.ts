import { createUserScopedSocketConnection } from '@/api/session/sockets';
import { markRpcRequestDisposition, readRpcRequestDisposition } from '@happier-dev/sync-client';
import { createManagedConnectionSupervisor, DEFAULT_MANAGED_CONNECTION_POLICY } from '@happier-dev/connection-supervisor';
import { classifyTransportErrorToProbeResult } from '@/api/connection/classifyTransportErrorToProbeResult';
import { createAuthenticationHttpStatusError } from '@/api/client/httpStatusError';

type RpcSocket = ReturnType<typeof createUserScopedSocketConnection>['socket'];

/** CLI-owned RPC lifetime; read-only observations use the shared reconnect owner. */
export async function withUserScopedRpcSocket<R>(
  params: Readonly<{
    token: string;
    serverUrl?: string;
    connectTimeoutMs: number;
    signal?: AbortSignal;
    disconnectMessage: string;
    /** Read-only observation only: reattach through the existing reconnect owner. */
    reattachOnReconnect?: true;
  }>,
  run: (socket: RpcSocket, connect: () => Promise<void>, signal?: AbortSignal) => Promise<R>,
): Promise<R> {
  params.signal?.throwIfAborted();
  if (params.reattachOnReconnect) {
    let current: Readonly<{ socket: RpcSocket; signal: AbortController }> | null = null;
    const abortCurrent = () => { current?.signal.abort(); };
    let resolveResult!: (result: R) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<R>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const onAbort = () => rejectResult(params.signal?.reason ?? new DOMException('RPC observation cancelled', 'AbortError'));
    const supervisor = createManagedConnectionSupervisor({
      ...DEFAULT_MANAGED_CONNECTION_POLICY,
      createTransport: () => {
        const connection = createUserScopedSocketConnection(params);
        const signal = new AbortController();
        current = { socket: connection.socket, signal };
        return { ...connection.transport, destroy: async () => {
          signal.abort();
          await connection.transport.destroy();
          connection.socket.close();
        } };
      },
      probeReadiness: async () => ({ status: 'ready' }),
      classifyTransportErrorToProbeResult,
      onDisconnected: abortCurrent,
      onConnected: () => {
        const attempt = current;
        if (!attempt) return;
        // A disconnected occurrence cannot settle the resumed observation with
        // a late acknowledgement. Reconnect reads the same owner's retained result.
        void run(attempt.socket, async () => { attempt.signal.signal.throwIfAborted(); }, attempt.signal.signal)
          .then((value) => { if (!attempt.signal.signal.aborted) resolveResult(value); }, (error: unknown) => {
            if (!attempt.signal.signal.aborted) rejectResult(error);
          });
      },
      onAuthFailed: ({ probe }) => rejectResult(createAuthenticationHttpStatusError(
        probe.statusCode === 403 ? 403 : 401, 'RPC observation authentication failed',
      )),
    });
    params.signal?.addEventListener('abort', onAbort, { once: true });
    if (params.signal?.aborted) onAbort();
    else void supervisor.start().catch(rejectResult);
    try { return await result; }
    finally {
      params.signal?.removeEventListener('abort', onAbort);
      abortCurrent();
      await supervisor.stop();
    }
  }
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
    return await run(connection.socket, connect, params.signal);
  } catch (error) {
    throw readRpcRequestDisposition(error) === null ? markRpcRequestDisposition(error, 'notSent') : error;
  } finally {
    try { await connection.transport.destroy(); } catch { /* Preserve the RPC result. */ }
    try { connection.socket.close(); } catch { /* Preserve the RPC result. */ }
  }
}
