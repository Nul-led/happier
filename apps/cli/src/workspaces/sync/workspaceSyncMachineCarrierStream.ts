import { once } from 'node:events';
import { connect, type Socket } from 'node:net';

export type WorkspaceSyncMachineTunnelOpenInput = Readonly<{
  operationId: string;
  sourceMachineId: string;
  targetMachineId: string;
  flow: 'workspace_sync';
  signal?: AbortSignal;
}>;

export type WorkspaceSyncMachineTunnel = Readonly<{
  localPort: number;
  observedPath: 'direct' | 'relay' | 'unknown';
  close(): Promise<void>;
}>;

/**
 * Lane 06 owns the authenticated Iroh lifecycle and exposes only its exact
 * per-stream loopback port. Lane 08 connects raw Mutagen bytes to that port;
 * it never handles QUIC, grants, handshakes, routing, or fallback selection.
 */
export type WorkspaceSyncMachineTunnelOpen = (
  input: WorkspaceSyncMachineTunnelOpenInput,
) => Promise<WorkspaceSyncMachineTunnel>;

function invalidTunnelPort(): Error {
  return Object.assign(new Error('Workspace sync machine tunnel did not expose a valid loopback port'), {
    code: 'machine_carrier_unavailable',
  });
}

export async function connectWorkspaceSyncMachineTunnel(
  tunnel: WorkspaceSyncMachineTunnel,
  signal?: AbortSignal,
): Promise<Socket> {
  if (!Number.isInteger(tunnel.localPort) || tunnel.localPort < 1 || tunnel.localPort > 65_535) {
    await tunnel.close().catch(() => undefined);
    throw invalidTunnelPort();
  }
  try {
    signal?.throwIfAborted();
  } catch (error) {
    await tunnel.close().catch(() => undefined);
    throw error;
  }
  const socket = connect({
    host: '127.0.0.1',
    port: tunnel.localPort,
    allowHalfOpen: true,
  });
  socket.setNoDelay(true);
  let closed = false;
  const closeTunnel = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', abort);
    await tunnel.close();
  };
  const abort = (): void => {
    socket.destroy(signal?.reason instanceof Error ? signal.reason : undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  socket.once('close', () => { void closeTunnel().catch(() => undefined); });
  try {
    await once(socket, 'connect');
    if (signal?.aborted) {
      abort();
      signal.throwIfAborted();
    }
    return socket;
  } catch (error) {
    socket.destroy();
    await closeTunnel().catch(() => undefined);
    throw error;
  }
}
