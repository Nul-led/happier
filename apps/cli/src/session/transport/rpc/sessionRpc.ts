import { createUserScopedSocket } from '@/api/session/sockets';
import { randomUUID } from 'node:crypto';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { createRpcCallError } from '@happier-dev/protocol/rpcErrors';
import { decodeBase64, decrypt, encodeBase64, encrypt } from '@/api/encryption';
import type { SessionEncryptionContext, SessionStoredContentEncryptionMode } from '@/session/transport/encryption/sessionEncryptionContext';
import { waitForSocketConnect } from '@/session/transport/socket/waitForSocketConnect';
import { createSocketRpcAbortScope, type SocketRpcAbortScope } from '@/session/transport/socket/createSocketRpcAbortScope';
import { resolveSessionControlSocketConnectTimeoutMs } from '@/session/transport/shared/sessionTimeouts';
import {
  markRpcRequestDisposition,
  readRpcRequestDisposition,
  type RpcRequestDisposition,
} from './rpcRequestDisposition';

export type SessionRpcRequestDisposition = RpcRequestDisposition;
export const readSessionRpcRequestDisposition = readRpcRequestDisposition;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

async function waitForConnectWithSignal(
  connectPromise: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await connectPromise;
    return;
  }
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([connectPromise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

type CallSessionRpcParams = Readonly<{
  token: string;
  sessionId: string;
  method: string;
  request: unknown;
  /** Null delegates acknowledgement lifetime to the caller signal/server lifecycle. */
  timeoutMs?: number | null;
  signal?: AbortSignal;
}> & (
  | Readonly<{ mode: 'plain'; ctx?: null }>
  | Readonly<{ mode?: 'e2ee'; ctx: SessionEncryptionContext }>
);

export async function callSessionRpc(params: CallSessionRpcParams): Promise<unknown> {
  let socket: ReturnType<typeof createUserScopedSocket> | null = null;
  let abortScope: SocketRpcAbortScope | null = null;
  let requestEmitted = false;
  try {
    params.signal?.throwIfAborted();
    const activeSocket = createUserScopedSocket({ token: params.token });
    socket = activeSocket;
    abortScope = createSocketRpcAbortScope({
      socket: activeSocket,
      ...(params.signal ? { callerSignal: params.signal } : {}),
      disconnectError: () => new Error('RPC socket disconnected before acknowledgement'),
    });
    const rpcSignal = abortScope.signal;
    const timeoutMs = params.timeoutMs === null
      ? null
      : typeof params.timeoutMs === 'number' && params.timeoutMs > 0
        ? params.timeoutMs
        : 20_000;
    const connectTimeoutMs = typeof timeoutMs === 'number' && typeof params.timeoutMs === 'number'
      ? timeoutMs
      : resolveSessionControlSocketConnectTimeoutMs();
    const connectPromise = waitForSocketConnect(activeSocket as unknown as import('socket.io-client').Socket, connectTimeoutMs);
    activeSocket.connect();
    rpcSignal.throwIfAborted();
    await waitForConnectWithSignal(connectPromise, rpcSignal);
    rpcSignal.throwIfAborted();

    const rpcParams = params.mode === 'plain'
      ? params.request
      : encodeBase64(encrypt(params.ctx.encryptionKey, params.ctx.encryptionVariant, params.request), 'base64');

    const response = await new Promise<{ ok: boolean; result?: unknown; error?: string; errorCode?: string }>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        rpcSignal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => settle(() => reject(abortReason(rpcSignal)));
      rpcSignal.addEventListener('abort', onAbort, { once: true });
      if (rpcSignal.aborted) {
        onAbort();
        return;
      }
      if (timeoutMs !== null) {
        timer = setTimeout(() => {
          settle(() => reject(new Error('RPC call timeout')));
        }, timeoutMs);
      }
      try {
        requestEmitted = true;
        const requestId = randomUUID();
        activeSocket.emit(
          SOCKET_RPC_EVENTS.CALL,
          {
            method: params.method,
            params: rpcParams,
            requestId,
            ...(timeoutMs !== null ? { timeoutMs } : {}),
          },
          (payload: { ok: boolean; result?: unknown; error?: string; errorCode?: string }) => {
            settle(() => resolve(payload));
          },
        );
      } catch (error) {
        settle(() => reject(error));
      }
    });

    if (!response.ok) {
      throw createRpcCallError({
        error: response.error || 'RPC call failed',
        errorCode: response.errorCode,
      });
    }

    if (params.mode === 'plain') {
      return response.result ?? null;
    }

    const encryptedResult = typeof response.result === 'string' ? response.result.trim() : '';
    if (!encryptedResult) return null;
    return decrypt(params.ctx.encryptionKey, params.ctx.encryptionVariant, decodeBase64(encryptedResult, 'base64'));
  } catch (error) {
    throw markRpcRequestDisposition(error, requestEmitted ? 'outcomeUnknown' : 'notSent');
  } finally {
    abortScope?.dispose();
    if (socket) {
      try {
        socket.disconnect();
        socket.close();
      } catch {
        // Preserve the original result.
      }
    }
  }
}
