import type { ManagedConnectionTransport } from '@happier-dev/connection-supervisor';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@/api/types';

/** Exact Home routing/profile identity paired with its immutable HTTP origin. */
export type SessionClientServerBinding = Readonly<{
    serverId: string;
    serverUrl: string;
}>;

/** Transport custody belongs to the composition that admitted this Session. */
export type SessionClientTransport = SessionClientServerBinding & Readonly<{
    createSessionSocketTransport: (binding: Readonly<{
        sessionId: string;
        machineId?: string;
    }>) => Readonly<{
        socket: Socket<ServerToClientEvents, ClientToServerEvents>;
        transport: ManagedConnectionTransport;
    }>;
    createAccountUpdatesSocket?: () => Socket<ServerToClientEvents, ClientToServerEvents>;
    resolveToken?: () => Promise<string | null>;
}>;
