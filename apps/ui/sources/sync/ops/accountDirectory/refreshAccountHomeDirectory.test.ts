import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';

const adoptHomeProfileMock = vi.hoisted(() => vi.fn(async (params: unknown) => params));
const getActiveServerSnapshotMock = vi.hoisted(() => vi.fn(() => ({ serverId: 'focused', serverUrl: 'https://focused.test', generation: 1 })));

vi.mock('@/sync/domains/server/serverProfiles', () => ({ adoptHomeProfile: adoptHomeProfileMock }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: getActiveServerSnapshotMock }));

const DIRECTORY_CAPABILITY = {
    version: 1 as const,
    homeDirectory: true as const,
    homeEnrollment: true as const,
    homeLoginAssertion: {
        keyId: 'a'.repeat(64),
        publicKeyBase64Url: 'A'.repeat(43),
    },
};

describe('refreshAccountHomeDirectory', () => {
    beforeEach(() => {
        adoptHomeProfileMock.mockReset();
        adoptHomeProfileMock.mockImplementation(async (params: unknown) => params);
        getActiveServerSnapshotMock.mockClear();
    });

    it('adopts directory homes without reading or changing focused Home state', async () => {
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');
        let refreshed: Record<string, unknown> | null = null;
        const session = {
            refresh: vi.fn(async () => (refreshed = {
                endpoint: 'https://directory.test', status: 'ready', preferredHomeServerIdentityId: 'home-1', refreshedAtMs: 1, error: null,
                reconciliation: { kind: 'not_run' },
                homes: [{
                    homeServerIdentityId: 'home-1', canonicalServerUrl: 'https://home.test', label: 'Home', createdAt: 1, updatedAt: 1,
                    connectionDescriptor: { v: 1, homeServerIdentityId: 'home-1', canonicalServerUrl: 'https://home.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.test' }] },
                }],
            })),
            recordReconciliation: vi.fn((reconciliation: unknown) => ({ ...refreshed, reconciliation })),
        };

        await refreshAccountHomeDirectory(session as never);
        expect(adoptHomeProfileMock).toHaveBeenCalledWith(expect.objectContaining({
            source: 'account-directory',
            preserveUserLabel: true,
        }));
        expect(getActiveServerSnapshotMock).not.toHaveBeenCalled();
    });

    it('does not adopt a late directory result after the owning Account Service attempt is cancelled', async () => {
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');
        let cancelled = false;
        let refreshed: Record<string, unknown> | null = null;
        const session = {
            refresh: vi.fn(async () => {
                cancelled = true;
                return (refreshed = {
                    endpoint: 'https://directory.test', status: 'ready', preferredHomeServerIdentityId: 'home-1', refreshedAtMs: 1, error: null,
                    reconciliation: { kind: 'not_run' },
                    homes: [{
                        homeServerIdentityId: 'home-1', canonicalServerUrl: 'https://home.test', label: 'Home', createdAt: 1, updatedAt: 1,
                        connectionDescriptor: { v: 1, homeServerIdentityId: 'home-1', canonicalServerUrl: 'https://home.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.test' }] },
                    }],
                });
            }),
            recordReconciliation: vi.fn((reconciliation: unknown) => ({ ...refreshed, reconciliation })),
        };

        await refreshAccountHomeDirectory(session as never, { shouldCancel: () => cancelled });

        expect(session.refresh).toHaveBeenCalledWith();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(session.recordReconciliation).toHaveBeenCalledWith({
            kind: 'cancelled',
            adopted: [],
            failures: [],
        });
    });

    it.each([
        ['first Home fails and the second succeeds', 'home-a', ['home-b']],
        ['first Home succeeds and the second fails', 'home-b', ['home-a']],
    ])('isolates adoption when the %s', async (_label, failingId, adoptedIds) => {
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');
        const homes = ['home-a', 'home-b'].map((homeServerIdentityId) => ({
            v: 1 as const,
            homeServerIdentityId,
            canonicalServerUrl: `https://${homeServerIdentityId}.test`,
            label: homeServerIdentityId === 'home-a' ? 'Home A' : 'Home B',
            preferred: homeServerIdentityId === 'home-a',
            connectionDescriptor: {
                v: 1 as const,
                homeServerIdentityId,
                canonicalServerUrl: `https://${homeServerIdentityId}.test`,
                revision: 1,
                endpoints: [{ kind: 'https' as const, url: `https://${homeServerIdentityId}.test` }],
            },
            createdAtMs: 1,
            updatedAtMs: 1,
        }));
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test', serverIdentityId: 'srv_dir_1' }, {
            client: { listHomes: vi.fn(async () => ({ homes, preferredHomeServerIdentityId: 'home-a' })) } as never,
            capability: DIRECTORY_CAPABILITY,
        });
        adoptHomeProfileMock.mockImplementation(async (params: unknown) => {
            const candidate = params as { descriptor: { homeServerIdentityId: string } };
            if (candidate.descriptor.homeServerIdentityId === failingId) throw new Error('identity conflict');
            return params;
        });

        const result = await refreshAccountHomeDirectory(session);

        expect(adoptHomeProfileMock).toHaveBeenCalledTimes(2);
        expect(result.reconciliation).toMatchObject({
            kind: 'completed',
            adopted: adoptedIds.map((homeServerIdentityId) => ({
                homeServerIdentityId,
                label: homeServerIdentityId === 'home-a' ? 'Home A' : 'Home B',
            })),
            failures: [{
                homeServerIdentityId: failingId,
                label: failingId === 'home-a' ? 'Home A' : 'Home B',
            }],
        });
        expect(getActiveServerSnapshotMock).not.toHaveBeenCalled();
    });

    it('stops later entries on cancellation without undoing an earlier success', async () => {
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');
        let cancelled = false;
        const homes = ['home-a', 'home-b'].map((homeServerIdentityId) => ({
            v: 1 as const,
            homeServerIdentityId,
            canonicalServerUrl: `https://${homeServerIdentityId}.test`,
            label: homeServerIdentityId,
            preferred: false,
            connectionDescriptor: {
                v: 1 as const,
                homeServerIdentityId,
                canonicalServerUrl: `https://${homeServerIdentityId}.test`,
                revision: 1,
                endpoints: [{ kind: 'https' as const, url: `https://${homeServerIdentityId}.test` }],
            },
            createdAtMs: 1,
            updatedAtMs: 1,
        }));
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test', serverIdentityId: 'srv_dir_1' }, {
            client: { listHomes: vi.fn(async () => ({ homes, preferredHomeServerIdentityId: null })) } as never,
            capability: DIRECTORY_CAPABILITY,
        });
        adoptHomeProfileMock.mockImplementationOnce(async (params: unknown) => {
            cancelled = true;
            return params;
        });

        const result = await refreshAccountHomeDirectory(session, { shouldCancel: () => cancelled });

        expect(adoptHomeProfileMock).toHaveBeenCalledTimes(1);
        expect(result.reconciliation).toEqual({
            kind: 'cancelled',
            adopted: [{ homeServerIdentityId: 'home-a', label: 'home-a' }],
            failures: [],
        });
    });

    it('performs no adoption when snapshot refresh fails and retains the typed snapshot failure', async () => {
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');
        const refreshError = new Error('directory unavailable');
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test', serverIdentityId: 'srv_dir_1' }, {
            client: { listHomes: vi.fn(async () => { throw refreshError; }) } as never,
            capability: DIRECTORY_CAPABILITY,
        });

        const result = await refreshAccountHomeDirectory(session);

        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            status: 'error',
            reconciliation: { kind: 'snapshot_unavailable', snapshotStatus: 'error', error: refreshError },
        });
    });

    it('does not let one cancelled orchestration caller suppress a concurrent valid session refresh', async () => {
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');
        let resolveHomes: ((value: {
            homes: Array<{
                v: 1;
                homeServerIdentityId: string;
                canonicalServerUrl: string;
                label: string;
                connectionDescriptor: {
                    v: 1;
                    homeServerIdentityId: string;
                    canonicalServerUrl: string;
                    revision: number;
                    endpoints: Array<{ kind: 'https'; url: string }>;
                };
                createdAtMs: number;
                updatedAtMs: number;
                preferred: boolean;
            }>;
            preferredHomeServerIdentityId: string;
        }) => void) | null = null;
        const client = {
            getMe: vi.fn(async () => ({ v: 1 as const, accountId: 'account-1', displayName: null, avatarUrl: null, linkedMethods: [] })),
            listHomes: vi.fn(() => new Promise((resolve) => { resolveHomes = resolve; })),
        };
        const session = new AccountDirectorySession({ endpoint: 'https://directory.test', serverIdentityId: 'srv_dir_1' }, {
            client: client as never,
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: {
                    keyId: 'a'.repeat(64),
                    publicKeyBase64Url: 'A'.repeat(43),
                },
            },
        });
        let firstCancelled = false;

        const cancelledCaller = refreshAccountHomeDirectory(session, { shouldCancel: () => firstCancelled });
        const validCaller = refreshAccountHomeDirectory(session);
        firstCancelled = true;
        resolveHomes!({
            homes: [{
                v: 1,
                homeServerIdentityId: 'home-1',
                canonicalServerUrl: 'https://home.test',
                label: 'Home',
                connectionDescriptor: {
                    v: 1,
                    homeServerIdentityId: 'home-1',
                    canonicalServerUrl: 'https://home.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://home.test' }],
                },
                createdAtMs: 1,
                updatedAtMs: 1,
                preferred: true,
            }],
            preferredHomeServerIdentityId: 'home-1',
        });

        await Promise.all([cancelledCaller, validCaller]);

        expect(session.snapshot.status).toBe('ready');
        expect(session.snapshot.preferredHomeServerIdentityId).toBe('home-1');
        expect(adoptHomeProfileMock).toHaveBeenCalledTimes(1);
    });
});
