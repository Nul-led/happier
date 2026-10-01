import { afterEach, expect, it, vi } from 'vitest';
import { createSystemTaskRunner } from '@/components/systemTasks/createSystemTaskRunner';
import { createDeterministicSystemTaskBridge } from '@/components/systemTasks/createDeterministicSystemTaskBridge';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { restoreConnectionToActiveServer, disconnectActiveServerConnection } from '@/sync/runtime/orchestration/connectionManager';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { setRuntimeFetch, resetRuntimeFetch } from '@/utils/system/runtimeFetch';
import { storage } from '@/sync/domains/state/storageStore';
import { readUnseenUpdateCompletions } from '@/updates/updateCompletions';
import { publishLocalDaemonStatus, startLocalCliUpdate } from './localDaemonSharedState';
import { readLocalDaemonStatusData } from './useLocalDaemonControl';

vi.mock('socket.io-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('socket.io-client')>();
    return { ...actual, io: (...args: Parameters<typeof actual.io>) => {
        const socket = actual.io(...args);
        // Only prevent the external connection; keep Socket and Sync lifecycle real.
        vi.spyOn(socket, 'connect').mockReturnValue(socket);
        return socket;
    } };
});
afterEach(async () => {
    vi.useRealTimers();
    await disconnectActiveServerConnection();
    storage.setState({ profileScope: null });
    resetRuntimeFetch();
    vi.restoreAllMocks();
});

it('records a shared update only at successful settlement for its initiating account, without an Updates observer', async () => {
    // The existing deterministic bridge substitutes the desktop process only.
    const home = await upsertAndActivateServer({ serverUrl: 'https://local-update-owner.example', name: 'Home' });
    const credentials = { token: 'e30.' + Buffer.from(JSON.stringify({ sub: 'owner-a' })).toString('base64url') + '.signature' };
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
    setRuntimeFetch(async (url) => new Response('{}', { status: new URL(String(url)).pathname === '/v1/auth/ping' ? 200 : 404 }));
    await restoreConnectionToActiveServer(credentials);
    vi.useFakeTimers();
    const runner = createSystemTaskRunner({ bridge: createDeterministicSystemTaskBridge(), mode: 'dev' });
    const serverId = home.id;
    const accountA = { serverId, accountId: 'owner-a' };
    const accountB = { serverId, accountId: 'owner-b' };
    expect(getActiveServerAccountScope()).toEqual(accountA);
    publishLocalDaemonStatus(runner, { machineId: 'machine-local-1' });
    const started = startLocalCliUpdate(runner, readLocalDaemonStatusData);
    await vi.advanceTimersByTimeAsync(0);
    storage.setState({ profileScope: accountB });
    await startLocalCliUpdate(runner, readLocalDaemonStatusData);
    expect(readUnseenUpdateCompletions(accountA).size).toBe(0);
    expect(readUnseenUpdateCompletions(accountB).size).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    await started;
    expect(readUnseenUpdateCompletions(accountA).get('machine-local-1:happier-cli')).toBe('done');
    expect(readUnseenUpdateCompletions(accountB).size).toBe(0);
});
