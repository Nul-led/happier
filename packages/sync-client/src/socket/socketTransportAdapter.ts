import type { ManagedConnectionTransport, TransportDisconnectEvent } from '@happier-dev/connection-supervisor';

export type SocketLike = Readonly<{
  connected: boolean; active?: boolean;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  io?: { on?(event: 'error', handler: (error: Error) => void): unknown; off?(event: 'error', handler: (error: Error) => void): unknown };
}> & {
  connect?(): unknown; open?(): unknown; disconnect?(): unknown; close?(): unknown;
  removeAllListeners?(): unknown; offAny?(): unknown;
};
export type SocketTransportAdapterOptions = Readonly<{ connectTimeoutMs?: number }>;
function connectionError(message: string, code: string): Error { return Object.assign(new Error(message), { code }); }

export function createSocketTransportAdapter(socket: SocketLike, options: SocketTransportAdapterOptions = {}): ManagedConnectionTransport {
  const connected = new Set<() => void>();
  const disconnected = new Set<(event: TransportDisconnectEvent) => void>();
  const errors = new Set<(error: unknown) => void>();
  const attemptErrors = new Set<(error: unknown) => void>();
  let intentional = false;
  let destroyed = false;
  let connecting: Promise<void> | null = null;
  const onConnect = () => connected.forEach((listener) => listener());
  const onDisconnect = (...args: unknown[]) => {
    const event = { intentional, reason: typeof args[0] === 'string' ? args[0] : undefined };
    intentional = false;
    disconnected.forEach((listener) => listener(event));
  };
  const onError = (error: unknown) => {
    attemptErrors.forEach((listener) => listener(error));
    if (socket.connected === true) errors.forEach((listener) => listener(error));
  };
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onError);
  socket.on('error', onError);
  socket.io?.on?.('error', onError);
  return {
    connect() {
      if (destroyed) return Promise.reject(connectionError('Socket transport destroyed', 'socket_destroyed'));
      if (socket.connected) return Promise.resolve();
      if (connecting) return connecting;
      intentional = false;
      const connect = socket.connect ?? socket.open;
      if (!connect) return Promise.reject(new Error('Socket transport cannot connect: missing connect/open method'));
      const attempt = new Promise<void>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (error?: unknown) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          connected.delete(ready);
          disconnected.delete(disconnect);
          attemptErrors.delete(failed);
          if (error === undefined) resolve(); else reject(error);
        };
        const ready = () => settle();
        const disconnect = (event: TransportDisconnectEvent) => settle(event.error ?? connectionError(event.reason ?? 'Socket disconnected before connect', 'socket_disconnected_before_connect'));
        const failed = (error: unknown) => settle(error instanceof Error ? error : new Error(String(error)));
        connected.add(ready);
        disconnected.add(disconnect);
        attemptErrors.add(failed);
        if (options.connectTimeoutMs !== undefined) timer = setTimeout(() => failed(connectionError(`Socket connect timeout after ${options.connectTimeoutMs}ms`, 'socket_connect_timeout')), options.connectTimeoutMs);
        try { connect.call(socket); } catch (error) { failed(error); }
      });
      connecting = attempt;
      void attempt.then(() => { connecting = null; }, () => { connecting = null; });
      return attempt;
    },
    async disconnect(options) {
      if (!socket.connected && socket.active !== true) {
        intentional = false;
        attemptErrors.forEach((listener) => listener(connectionError('Socket disconnected before connect', 'socket_disconnected_before_connect')));
        return;
      }
      intentional = options?.intentional === true;
      try {
        (socket.disconnect ?? socket.close)?.call(socket);
        if (!socket.connected) attemptErrors.forEach((listener) => listener(connectionError('Socket disconnected before connect', 'socket_disconnected_before_connect')));
      } catch (error) {
        intentional = false;
        if (!(error instanceof Error && error.message.toLowerCase().includes('socket has been disconnected'))) throw error;
      }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      intentional = false;
      attemptErrors.forEach((listener) => listener(connectionError('Socket transport destroyed', 'socket_destroyed')));
      connected.clear(); disconnected.clear(); errors.clear(); attemptErrors.clear();
      socket.io?.off?.('error', onError);
      socket.offAny?.();
      socket.removeAllListeners?.();
      try { (socket.disconnect ?? socket.close)?.call(socket); } catch { /* Disposal is idempotent. */ }
    },
    isConnected: () => !destroyed && socket.connected === true,
    onConnected(listener) { connected.add(listener); return () => { connected.delete(listener); }; },
    onDisconnected(listener) { disconnected.add(listener); return () => { disconnected.delete(listener); }; },
    onError(listener) { errors.add(listener); return () => { errors.delete(listener); }; },
  };
}
