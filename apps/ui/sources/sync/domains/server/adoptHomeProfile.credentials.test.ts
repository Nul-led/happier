import { afterEach, describe, expect, it, vi } from 'vitest';

type TokenStorageModule = typeof import('@/auth/storage/tokenStorage');
type SetCredentialsForServerUrl = TokenStorageModule['TokenStorage']['setCredentialsForServerUrl'];
type SetCredentialsForServerUrlWithRollback = TokenStorageModule['TokenStorage']['setCredentialsForServerUrlWithRollback'];

const setCredentialsForServerUrlMock = vi.hoisted(() => vi.fn<SetCredentialsForServerUrl>(async () => true));
const setCredentialsForServerUrlWithRollbackMock = vi.hoisted(() => vi.fn<SetCredentialsForServerUrlWithRollback>());

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        setCredentialsForServerUrl: (...args: Parameters<SetCredentialsForServerUrl>) => setCredentialsForServerUrlMock(...args),
        setCredentialsForServerUrlWithRollback: (...args: Parameters<SetCredentialsForServerUrlWithRollback>) => setCredentialsForServerUrlWithRollbackMock(...args),
    },
}));

describe('adoptHomeProfileWithCredentials', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        setCredentialsForServerUrlMock.mockReset();
        setCredentialsForServerUrlMock.mockResolvedValue(true);
        setCredentialsForServerUrlWithRollbackMock.mockReset();
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        vi.resetModules();
    });

    it.each([
        ['the previous credential', { token: 'previous-home-b-token' }],
        ['an empty target', null],
    ])('restores %s when final profile adoption fails after the credential write', async (_label, priorCredential) => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_credentials_rollback_${Date.now()}_${Math.random()}`;
        const profiles = await import('./serverProfiles');
        const focused = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        profiles.setActiveServerId(focused.id);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: focused.id,
            groups: [{ id: 'g', name: 'Homes', serverIds: [focused.id] }],
        });
        const focusBefore = profiles.getActiveServerSnapshot();
        const viewBefore = profiles.loadHomeViewState();
        let storedCredential = priorCredential;
        const rollback = vi.fn(async () => {
            storedCredential = priorCredential;
            return true;
        });
        setCredentialsForServerUrlWithRollbackMock.mockImplementationOnce(async (
            _serverUrl: string,
            _options: unknown,
            credentials: typeof priorCredential,
        ) => {
            storedCredential = credentials;
            const competitor = profiles.upsertServerProfile({
                serverUrl: 'https://home-b.test',
                source: 'manual',
            });
            profiles.setServerProfileIdentityForUrl(competitor.serverUrl, 'srv_competing_home');
            return {
                serverUrl: 'https://home-b.test',
                serverId: 'srv_home_b',
                rollback,
            };
        });
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        await expect(adoptHomeProfileWithCredentials({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'qr',
            credentials: { token: 'new-home-b-token' },
        })).rejects.toThrow('Home identity conflicts with URL');

        expect(rollback).toHaveBeenCalledOnce();
        expect(storedCredential).toEqual(priorCredential);
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: focusBefore.serverId,
            serverUrl: focusBefore.serverUrl,
        });
        expect(profiles.loadHomeViewState()).toEqual(viewBefore);
    });

    it('preserves the adoption error when credential rollback itself rejects', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_credentials_rollback_failure_${Date.now()}_${Math.random()}`;
        const profiles = await import('./serverProfiles');
        const rollback = vi.fn(async () => {
            throw new Error('credential rollback failed');
        });
        setCredentialsForServerUrlWithRollbackMock.mockImplementationOnce(async () => {
            const competitor = profiles.upsertServerProfile({
                serverUrl: 'https://home-b.test',
                source: 'manual',
            });
            profiles.setServerProfileIdentityForUrl(competitor.serverUrl, 'srv_competing_home');
            return {
                serverUrl: 'https://home-b.test',
                serverId: 'srv_home_b',
                rollback,
            };
        });
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        await expect(adoptHomeProfileWithCredentials({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'qr',
            credentials: { token: 'new-home-b-token' },
        })).rejects.toThrow('Home identity conflicts with URL');
        expect(rollback).toHaveBeenCalledOnce();
    });

    it('writes credentials under the canonical preflight target, then adopts without changing focus or groups', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_credentials_${Date.now()}_${Math.random()}`;
        const profiles = await import('./serverProfiles');
        const focused = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        profiles.setActiveServerId(focused.id);
        const activeBefore = profiles.getActiveServerSnapshot();
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: focused.id,
            groups: [{ id: 'g', name: 'Homes', serverIds: [focused.id] }],
        });
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        const rollback = vi.fn(async () => true);
        setCredentialsForServerUrlWithRollbackMock.mockImplementationOnce(async () => {
            expect(profiles.listServerProfiles()).not.toEqual(expect.arrayContaining([
                expect.objectContaining({ serverIdentityId: 'srv_home_b' }),
            ]));
            return {
                serverUrl: 'https://home-b.test',
                serverId: 'srv_home_b',
                rollback,
            };
        });

        const adopted = await adoptHomeProfileWithCredentials({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'qr',
            preserveUserLabel: true,
            suggestedName: 'Home B',
            credentials: { token: 'home-b-token' },
        });

        expect(adopted.serverIdentityId).toBe('srv_home_b');
        expect(adopted.name).toBe('Home B');
        expect(setCredentialsForServerUrlWithRollbackMock).toHaveBeenCalledWith(
            adopted.canonicalServerUrl ?? adopted.serverUrl,
            { serverId: adopted.serverIdentityId },
            { token: 'home-b-token' },
        );
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(rollback).not.toHaveBeenCalled();
        expect(profiles.loadHomeViewState()).toMatchObject({
            activeTargetId: focused.id,
            groups: [{ id: 'g', serverIds: [focused.id] }],
        });
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });
    });

    it('leaves profile, focus, and groups unchanged when the credential write fails', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_credentials_write_failure_${Date.now()}_${Math.random()}`;
        const profiles = await import('./serverProfiles');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        setCredentialsForServerUrlWithRollbackMock.mockResolvedValueOnce(null);

        await expect(adoptHomeProfileWithCredentials({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'qr',
            preserveUserLabel: true,
            credentials: { token: 'home-b-token' },
        })).rejects.toThrow('Unable to store Home credentials');

        expect(profiles.listServerProfiles()).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_home_b' }),
        ]));
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('does not write credentials when adoption rejects an identity conflict', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_credentials_conflict_${Date.now()}_${Math.random()}`;
        const profiles = await import('./serverProfiles');
        await profiles.adoptHomeProfile({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_existing',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'account-directory',
        });
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        await expect(adoptHomeProfileWithCredentials({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_conflicting',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'account-directory',
            credentials: { token: 'must-not-store' },
        })).rejects.toThrow('Home identity conflicts with URL');
        expect(setCredentialsForServerUrlWithRollbackMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('rolls back an exact credential write when the owning enrollment attempt is cancelled before profile adoption', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_credentials_cancelled_${Date.now()}_${Math.random()}`;
        const profiles = await import('./serverProfiles');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        let cancelled = false;
        const rollback = vi.fn(async () => true);
        setCredentialsForServerUrlWithRollbackMock.mockImplementationOnce(async () => {
            cancelled = true;
            return {
                serverUrl: 'https://home-b.test',
                serverId: 'srv_home_b',
                rollback,
            };
        });

        await expect(adoptHomeProfileWithCredentials({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
            },
            source: 'account-directory',
            credentials: { token: 'must-roll-back' },
            shouldCancel: () => cancelled,
        })).rejects.toThrow('Home credential adoption cancelled');

        expect(rollback).toHaveBeenCalledOnce();
        expect(profiles.listServerProfiles()).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_home_b' }),
        ]));
    });

    it('uses a nonempty Directory hint for a new profile and preserves an existing user label', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_suggested_name_${Date.now()}_${Math.random()}`;
        const profiles = await import('./serverProfiles');
        const created = await profiles.adoptHomeProfile({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_directory_home',
                canonicalServerUrl: 'https://directory-home.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://directory-home.test' }],
            },
            source: 'account-directory',
            preserveUserLabel: true,
            suggestedName: '  Directory Home  ',
        });
        expect(created.name).toBe('Directory Home');

        profiles.renameServerProfile(created.id, 'My Home');
        const preserved = await profiles.adoptHomeProfile({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_directory_home',
                canonicalServerUrl: 'https://directory-home.test',
                revision: 2,
                endpoints: [{ kind: 'https', url: 'https://directory-home.test' }],
            },
            source: 'account-directory',
            preserveUserLabel: true,
            suggestedName: '   ',
        });
        expect(preserved.name).toBe('My Home');
    });

    it('does not write an orphan credential when strict adoption rejects the descriptor', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_credentials_invalid_${Date.now()}_${Math.random()}`;
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        await expect(adoptHomeProfileWithCredentials({
            descriptor: {
                serverUrl: 'https://unbound-home.test',
            },
            source: 'qr',
            preserveUserLabel: true,
            credentials: { token: 'must-not-store' },
        })).rejects.toThrow();
        expect(setCredentialsForServerUrlWithRollbackMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });
});
