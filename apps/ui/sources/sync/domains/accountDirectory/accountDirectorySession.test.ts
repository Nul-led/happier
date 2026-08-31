import { describe, expect, it, vi } from 'vitest';
import { AccountDirectorySession } from './accountDirectorySession';

const logoutMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/auth/accountDirectory/accountDirectoryCredentialStorage', () => ({
    accountDirectoryCredentialStorage: { logout: logoutMock },
    normalizeAccountDirectoryEndpoint: (value: string) => value.trim().replace(/\/+$/, ''),
}));

function home(identity: string) {
    return {
        v: 1 as const,
        homeServerIdentityId: identity,
        canonicalServerUrl: `https://${identity}.test`,
        label: identity,
        connectionDescriptor: {
            v: 1 as const,
            homeServerIdentityId: identity,
            canonicalServerUrl: `https://${identity}.test`,
            revision: 1,
            endpoints: [{ kind: 'https' as const, url: `https://${identity}.test` }],
        },
        createdAtMs: 1,
        updatedAtMs: 1,
        preferred: false,
    };
}

describe('AccountDirectorySession', () => {
    const supportedCapability = {
        version: 1 as const,
        homeDirectory: true,
        homeEnrollment: true,
        homeLoginAssertion: {
            keyId: 'a'.repeat(64),
            publicKeyBase64Url: 'A'.repeat(43),
        },
    };

    it('disconnects only the selected Account Service identity at a reused URL', async () => {
        const client = { getMe: vi.fn(), listHomes: vi.fn() };
        const session = new AccountDirectorySession({
            endpoint: 'https://directory.test',
            serverIdentityId: 'directory-new',
        }, { client: client as never, capability: supportedCapability });

        await expect(session.logout()).resolves.toBe(true);

        expect(logoutMock).toHaveBeenCalledWith({
            endpoint: 'https://directory.test',
            serverIdentityId: 'directory-new',
        });
    });

    it('deduplicates concurrent refresh and retains cached homes during outage', async () => {
        let resolveList: ((value: { homes: ReturnType<typeof home>[] }) => void) | null = null;
        const client = {
            getMe: vi.fn(async () => ({ accountId: 'a' })),
            listHomes: vi.fn(() => new Promise<{ homes: ReturnType<typeof home>[] }>((resolve) => { resolveList = resolve; })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: supportedCapability,
        });
        const first = session.refresh();
        const second = session.refresh();
        expect(client.listHomes).toHaveBeenCalledTimes(1);
        resolveList!({ homes: [home('home-1')] });
        await Promise.all([first, second]);
        expect(session.snapshot.status).toBe('ready');

        client.listHomes.mockRejectedValueOnce(new Error('offline'));
        const stale = await session.refresh();
        expect(stale.status).toBe('stale');
        expect(stale.homes).toHaveLength(1);
    });

    it('does not project a refresh result after the owning lifecycle cancels the attempt', async () => {
        let resolveList: ((value: { homes: ReturnType<typeof home>[]; preferredHomeServerIdentityId: string }) => void) | null = null;
        let cancelled = false;
        const client = {
            getMe: vi.fn(async () => ({ accountId: 'a' })),
            listHomes: vi.fn(() => new Promise<{ homes: ReturnType<typeof home>[]; preferredHomeServerIdentityId: string }>((resolve) => {
                resolveList = resolve;
            })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: supportedCapability,
        });

        const refresh = session.refresh({ shouldCancel: () => cancelled });
        cancelled = true;
        resolveList!({ homes: [home('home-late')], preferredHomeServerIdentityId: 'home-late' });
        await refresh;

        expect(session.snapshot).not.toMatchObject({
            status: 'ready',
            preferredHomeServerIdentityId: 'home-late',
        });
        expect(session.snapshot.homes).toEqual([]);
    });

    it('keeps logout authoritative when an older refresh resolves late', async () => {
        let resolveList: ((value: { homes: ReturnType<typeof home>[]; preferredHomeServerIdentityId: string }) => void) | null = null;
        const client = {
            getMe: vi.fn(async () => ({ accountId: 'a' })),
            listHomes: vi.fn(() => new Promise<{ homes: ReturnType<typeof home>[]; preferredHomeServerIdentityId: string }>((resolve) => {
                resolveList = resolve;
            })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: supportedCapability,
        });

        const refresh = session.refresh();
        await session.logout();
        resolveList!({ homes: [home('home-late')], preferredHomeServerIdentityId: 'home-late' });
        await refresh;

        expect(session.snapshot).toMatchObject({ status: 'idle', account: null });
        expect(session.snapshot.homes).toEqual([]);
    });

    it.each([
        ['missing', undefined],
        ['malformed', { version: 1, homeDirectory: true, homeEnrollment: true }],
        ['unsupported version', { ...supportedCapability, version: 2 }],
    ])('fails closed before refresh for a %s capability', async (_name, capability) => {
        const client = {
            getMe: vi.fn(async () => ({ accountId: 'a' })),
            listHomes: vi.fn(async () => ({ homes: [] })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: capability as never,
        });

        await expect(session.refresh()).resolves.toMatchObject({ status: 'unsupported' });
        expect(client.getMe).not.toHaveBeenCalled();
        expect(client.listHomes).not.toHaveBeenCalled();
    });

    it('does not let assertion mint bypass a capability without Home enrollment', async () => {
        const client = {
            getMe: vi.fn(),
            listHomes: vi.fn(),
            requestLoginAssertion: vi.fn(async () => ({ v: 1 })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: { ...supportedCapability, homeEnrollment: false },
        });

        await expect(session.requestLoginAssertion('home-1', 'client-key')).rejects.toThrow();
        expect(client.requestLoginAssertion).not.toHaveBeenCalled();
    });

    it('allows assertion mint when the published capability supports Home enrollment', async () => {
        const client = {
            getMe: vi.fn(),
            listHomes: vi.fn(),
            requestLoginAssertion: vi.fn(async () => ({ v: 1 })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: supportedCapability,
        });

        await expect(session.requestLoginAssertion('home-1', 'client-key')).resolves.toEqual({ v: 1 });
        expect(client.requestLoginAssertion).toHaveBeenCalledOnce();
    });

    it('does not let directory publication bypass a capability without Home directory', async () => {
        const client = {
            getMe: vi.fn(),
            listHomes: vi.fn(),
            putHome: vi.fn(async () => home('home-1')),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: { ...supportedCapability, homeDirectory: false },
        });

        await expect(session.putHome({
            homeServerIdentityId: 'home-1',
            label: 'home-1',
            connectionDescriptor: home('home-1').connectionDescriptor,
        })).rejects.toThrow();
        expect(client.putHome).not.toHaveBeenCalled();
    });

    it('reads the account summary and publishes a Home entry through the client', async () => {
        const client = {
            getMe: vi.fn(async () => ({ accountId: 'account-1' })),
            listHomes: vi.fn(),
            putHome: vi.fn(async () => home('home-1')),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: supportedCapability,
        });

        await expect(session.readAccountSummary()).resolves.toEqual({ accountId: 'account-1' });
        await expect(session.putHome({
            homeServerIdentityId: 'home-1',
            label: 'home-1',
            connectionDescriptor: home('home-1').connectionDescriptor,
        })).resolves.toEqual(home('home-1'));
        expect(client.putHome).toHaveBeenCalledWith({
            homeServerIdentityId: 'home-1',
            label: 'home-1',
            connectionDescriptor: home('home-1').connectionDescriptor,
        });
    });

    it('routes preferred and remove commands through the capability-gated Directory client', async () => {
        const client = {
            getMe: vi.fn(),
            listHomes: vi.fn(),
            setPreferredHome: vi.fn(async () => ({
                v: 1,
                preferredHomeServerIdentityId: 'home-2',
            })),
            deleteHome: vi.fn(async () => ({
                v: 1,
                deleted: true,
                homeServerIdentityId: 'home-1',
                preferredHomeServerIdentityId: 'home-2',
            })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: supportedCapability,
        });

        await expect(session.setPreferredHome('home-2')).resolves.toMatchObject({
            preferredHomeServerIdentityId: 'home-2',
        });
        await expect(session.deleteHome('home-1')).resolves.toMatchObject({
            deleted: true,
            homeServerIdentityId: 'home-1',
        });
        expect(client.setPreferredHome).toHaveBeenCalledWith('home-2');
        expect(client.deleteHome).toHaveBeenCalledWith('home-1');
    });

    it('fails closed before preferred and remove commands without Home Directory capability', async () => {
        const client = {
            getMe: vi.fn(),
            listHomes: vi.fn(),
            setPreferredHome: vi.fn(),
            deleteHome: vi.fn(),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test' }, {
            client: client as never,
            capability: { ...supportedCapability, homeDirectory: false },
        });

        await expect(session.setPreferredHome('home-2')).rejects.toThrow();
        await expect(session.deleteHome('home-1')).rejects.toThrow();
        expect(client.setPreferredHome).not.toHaveBeenCalled();
        expect(client.deleteHome).not.toHaveBeenCalled();
    });
});
