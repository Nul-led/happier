import { vi } from 'vitest';
import type { Socket } from 'socket.io-client';

const socketBoundary = vi.hoisted(() => ({ configure: undefined as ((socket: Socket) => void) | undefined }));

/** Keep the real Socket and Sync owners; only the external transport is replaced. */
export function installDisconnectedServerSocketBoundary(configure?: (socket: Socket) => void): void {
    socketBoundary.configure = configure;
    vi.mock('socket.io-client', async (importOriginal) => {
        const actual = await importOriginal<typeof import('socket.io-client')>();
        return { ...actual, io: (...args: Parameters<typeof actual.io>) => {
            const socket = actual.io(...args);
            vi.spyOn(socket, 'connect').mockReturnValue(socket);
            socketBoundary.configure?.(socket);
            return socket;
        } };
    });
}

/** Apply a real Account lifetime before a test installs its domain data or fake clock. */
export async function restoreServerAccountForTest(params: Readonly<{
    serverUrl: string;
    accountId?: string;
    request?: NonNullable<Parameters<typeof import('@/utils/system/runtimeFetch').setRuntimeFetch>[0]>;
}>) {
    const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
    const { TokenStorage } = await import('@/auth/storage/tokenStorage');
    const { setRuntimeFetch, resetRuntimeFetch } = await import('@/utils/system/runtimeFetch');
    const { restoreConnectionToActiveServer, disconnectActiveServerConnection } = await import('@/sync/runtime/orchestration/connectionManager');
    const home = await upsertAndActivateServer({ serverUrl: params.serverUrl, name: 'Test Home' });
    const credentials = { token: `e30.${Buffer.from(JSON.stringify({ sub: params.accountId ?? 'account-a' })).toString('base64url')}.signature` };
    const credentialBoundary = vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
    setRuntimeFetch(async (url, init) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.origin !== new URL(home.serverUrl).origin) {
            throw new Error(`Unexpected test Home request origin: ${requestUrl.origin}`);
        }
        if (requestUrl.pathname === '/v1/auth/ping') return new Response('{}', { status: 200 });
        return params.request ? params.request(url, init) : new Response('{}', { status: 404 });
    });
    await restoreConnectionToActiveServer(credentials);
    return {
        home,
        credentials,
        async dispose() {
            await disconnectActiveServerConnection();
            resetRuntimeFetch();
            credentialBoundary.mockRestore();
        },
    };
}
