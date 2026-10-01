import { io, type Socket } from 'socket.io-client';
import type { ManagedConnectionTransport } from '@happier-dev/connection-supervisor';
import { createSocketTransportAdapter } from './socketTransportAdapter.js';
import { websocketFactoryTransport, type HappierWebSocketFactory } from './websocketFactoryTransport.js';

export type HappierSocket = Socket;
export type HappierSocketRole =
  | Readonly<{ clientType: 'user-scoped' }>
  | Readonly<{ clientType: 'session-scoped'; sessionId: string; machineId?: string }>
  | Readonly<{ clientType: 'machine-scoped'; machineId: string }>;
export type CreateHappierSocketParams = HappierSocketRole & Readonly<{
  endpoint: string; token: string; clientPurpose?: string;
  authExtras?: Readonly<Record<string, unknown>>;
  transports?: readonly string[];
  websocketFactory?: HappierWebSocketFactory;
  withCredentials?: boolean;
  engineOptions?: Readonly<Record<string, unknown>>;
  connectTimeoutMs?: number;
}>;
export function createHappierSocket(params: CreateHappierSocketParams): Readonly<{ socket: HappierSocket; transport: ManagedConnectionTransport }> {
  const auth: Record<string, unknown> = { ...params.authExtras, token: params.token, clientType: params.clientType };
  delete auth.sessionId;
  delete auth.machineId;
  if (params.clientType === 'session-scoped') {
    auth.sessionId = params.sessionId;
    if (params.machineId !== undefined) auth.machineId = params.machineId;
  } else if (params.clientType === 'machine-scoped') auth.machineId = params.machineId;
  if (params.clientPurpose !== undefined) auth.clientPurpose = params.clientPurpose;
  const transports = params.websocketFactory ? websocketFactoryTransport(params.websocketFactory) : params.transports ? [...params.transports] : undefined;
  const socket = io(params.endpoint.trim().replace(/\/+$/, ''), {
    ...params.engineOptions,
    path: '/v1/updates/', auth,
    ...(transports ? { transports } : {}),
    withCredentials: params.withCredentials ?? false,
    forceNew: true, multiplex: false, reconnection: false, autoConnect: false,
    ...(params.connectTimeoutMs === undefined ? {} : { timeout: params.connectTimeoutMs }),
  });
  // Manager.timeout supports false; constructor options only type numbers.
  // autoConnect is disabled, so configure the caller's bound before any attempt.
  socket.io.timeout(params.connectTimeoutMs ?? false);
  return { socket, transport: createSocketTransportAdapter(socket, { connectTimeoutMs: params.connectTimeoutMs }) };
}
