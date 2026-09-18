import { resolveServerHttpBaseUrl } from './serverHttpBaseUrl';
import { readStoredCredentials } from '@/persistence';
import { createSessionSocketTransport } from '@/api/session/connection/createSessionSocketTransport';
import { createUserScopedSocket } from '@/api/session/sockets';
import type { SessionClientTransport } from '@/api/session/client/transport/sessionClientTransport';
import { configuration } from '@/configuration';

/** Ordinary Account clients retain AccessKey provisioning and Account updates. */
export function createAccountSessionClientTransport(token: string): SessionClientTransport {
    const serverId = configuration.activeServerId;
    const serverUrl = resolveServerHttpBaseUrl();
    return Object.freeze({
        serverId,
        serverUrl,
        createSessionSocketTransport: (binding) => createSessionSocketTransport({ token, serverUrl, ...binding }),
        createAccountUpdatesSocket: () => createUserScopedSocket({ token, serverUrl }),
        resolveToken: async () => (await readStoredCredentials())?.token ?? null,
    });
}
