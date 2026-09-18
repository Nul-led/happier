import { afterEach, describe, expect, it, vi } from 'vitest';

const getCredentialsSpy = vi.hoisted(() => vi.fn());
const createEncryptionSpy = vi.hoisted(() => vi.fn());
const listServerProfilesSpy = vi.hoisted(() => vi.fn());
const getActiveServerSnapshotSpy = vi.hoisted(() => vi.fn());

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub }))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    return `e30.${payload}.signature`;
}

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    // Only the credential read is stubbed; the credential-shape predicates stay real so
    // this suite keeps exercising the actual token-only/legacy/dataKey classification.
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsSpy(...args),
        },
    };
});

vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: (...args: unknown[]) => createEncryptionSpy(...args),
}));

vi.mock('@/sync/domains/server/serverProfiles', async () => {
    const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createServerProfilesModuleMock({
        listServerProfiles: (...args: unknown[]) => listServerProfilesSpy(...args),
    });
});

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: (...args: unknown[]) => getActiveServerSnapshotSpy(...args),
}));

describe('resolveServerScopedContext', () => {
    afterEach(() => {
        getCredentialsSpy.mockReset();
        createEncryptionSpy.mockReset();
        listServerProfilesSpy.mockReset();
        getActiveServerSnapshotSpy.mockReset();
    });

    it('returns active scope when serverId is missing', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            generation: 1,
        });

        const { resolveServerScopedContext } = await import('./resolveServerScopedContext');
        const context = await resolveServerScopedContext({
            machineId: 'machine-1',
        });

        expect(context).toEqual(expect.objectContaining({
            scope: 'active',
            machineId: 'machine-1',
            timeoutMs: 30000,
        }));
    });

    it('returns active scope when the target profile id aliases the active durable server identity', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_server_a',
            serverUrl: 'https://server-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([
            {
                id: 'localhost-52753',
                serverIdentityId: 'srv_server_a',
                serverUrl: 'https://server-a.example.test',
                name: 'Server A',
            },
        ]);
        getCredentialsSpy.mockResolvedValue({ token: 'token-a', secret: 'secret-a' });

        const { resolveServerScopedContext } = await import('./resolveServerScopedContext');
        const context = await resolveServerScopedContext({
            machineId: 'machine-1',
            serverId: 'localhost-52753',
        });

        expect(context).toEqual(expect.objectContaining({
            scope: 'active',
            machineId: 'machine-1',
            timeoutMs: 30000,
        }));
        expect(getCredentialsSpy).not.toHaveBeenCalled();
    });

    it('returns scoped context with credentials and encryption when target differs from active server', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-b', serverUrl: 'https://server-b.example.test', name: 'Server B' },
        ]);
        const token = tokenForSub('account-b');
        const credentials = { token, secret: 'secret-b' } as const;
        getCredentialsSpy.mockResolvedValue(credentials);
        const fakeEncryption = {
            decryptEncryptionKey: vi.fn(async () => null),
            initializeMachines: vi.fn(async () => {}),
            getMachineEncryption: vi.fn(),
        };
        createEncryptionSpy.mockResolvedValue(fakeEncryption);

        const { resolveServerScopedContext } = await import('./resolveServerScopedContext');
        const context = await resolveServerScopedContext({
            machineId: 'machine-1',
            serverId: 'server-b',
            timeoutMs: 5000,
        });

        expect(context).toEqual(expect.objectContaining({
            scope: 'scoped',
            machineId: 'machine-1',
            timeoutMs: 5000,
            targetServerId: 'server-b',
            targetServerUrl: 'https://server-b.example.test',
            targetAccountId: 'account-b',
            token,
            credentials,
            encryption: fakeEncryption,
        }));
    });

    it('can force scoped context for the active server', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            generation: 1,
        });
        const token = tokenForSub('account-a');
        getCredentialsSpy.mockResolvedValue({ token, secret: 'secret-a' });
        const fakeEncryption = {
            decryptEncryptionKey: vi.fn(async () => null),
            initializeMachines: vi.fn(async () => {}),
            getMachineEncryption: vi.fn(),
        };
        createEncryptionSpy.mockResolvedValue(fakeEncryption);

        const { resolveServerScopedContext } = await import('./resolveServerScopedContext');
        const context = await resolveServerScopedContext({
            machineId: 'machine-1',
            forceScoped: true,
            timeoutMs: 5000,
        });

        expect(context).toEqual(expect.objectContaining({
            scope: 'scoped',
            machineId: 'machine-1',
            timeoutMs: 5000,
            targetServerId: 'server-a',
            targetServerUrl: 'https://server-a.example.test',
            targetAccountId: 'account-a',
            token,
            encryption: fakeEncryption,
        }));
    });

    it('fails closed when scoped credentials belong to a different Account than requested', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            generation: 1,
        });
        getCredentialsSpy.mockResolvedValue({ token: tokenForSub('account-b'), secret: 'secret-b' });

        const { resolveServerScopedContext } = await import('./resolveServerScopedContext');
        await expect(resolveServerScopedContext({
            machineId: 'machine-1',
            serverId: 'server-a',
            accountId: 'account-a',
            forceScoped: true,
        })).rejects.toThrow('do not match requested Account');
        expect(createEncryptionSpy).not.toHaveBeenCalled();
    });
});
