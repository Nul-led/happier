import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
let readFailure: Error | null = null;
vi.mock('@/auth/storage/deviceLocalStorage', () => ({
    readDeviceLocalStorageString: vi.fn(async (key: string) => {
        if (readFailure) throw readFailure;
        return storage.get(key) ?? null;
    }),
    writeDeviceLocalStorageString: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeDeviceLocalStorageString: vi.fn(async (key: string) => { storage.delete(key); }),
}));

describe('account directory credential storage', () => {
    afterEach(() => {
        storage.clear();
        readFailure = null;
        delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
    });

    it('isolates credentials by endpoint and supports independent removal', async () => {
        const { accountDirectoryCredentialStorage } = await import('./accountDirectoryCredentialStorage');
        await accountDirectoryCredentialStorage.set({ endpoint: 'https://directory-a.test', serverIdentityId: 'directory-a' }, { token: 'a' });
        await accountDirectoryCredentialStorage.set({ endpoint: 'https://directory-b.test', serverIdentityId: 'directory-b' }, { token: 'b' });

        await expect(accountDirectoryCredentialStorage.get({ endpoint: 'https://directory-a.test', serverIdentityId: 'directory-a' })).resolves.toEqual({ token: 'a' });
        await expect(accountDirectoryCredentialStorage.get({ endpoint: 'https://directory-b.test', serverIdentityId: 'directory-b' })).resolves.toEqual({ token: 'b' });

        await accountDirectoryCredentialStorage.remove({ endpoint: 'https://directory-a.test', serverIdentityId: 'directory-a' });
        await expect(accountDirectoryCredentialStorage.get({ endpoint: 'https://directory-a.test', serverIdentityId: 'directory-a' })).resolves.toBeNull();
        await expect(accountDirectoryCredentialStorage.get({ endpoint: 'https://directory-b.test', serverIdentityId: 'directory-b' })).resolves.toEqual({ token: 'b' });
    });

    it('distinguishes absent, valid, corrupt, and unavailable custody', async () => {
        const { writeDeviceLocalStorageString } = await import('@/auth/storage/deviceLocalStorage');
        const { accountDirectoryCredentialStorage } = await import('./accountDirectoryCredentialStorage');
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'srv_directory-1' };

        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({ kind: 'absent' });
        await accountDirectoryCredentialStorage.set(target, { token: 'directory-token' });
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({
            kind: 'valid',
            value: { token: 'directory-token' },
        });

        await writeDeviceLocalStorageString('account_directory_auth_credentials', '{"bad":true}');
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({ kind: 'corrupt' });

        readFailure = new Error('secure storage unavailable');
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({ kind: 'unavailable' });
    });

    it('does not mutate credentials after corrupt or unavailable custody reads', async () => {
        const { writeDeviceLocalStorageString } = await import('@/auth/storage/deviceLocalStorage');
        const { accountDirectoryCredentialStorage } = await import('./accountDirectoryCredentialStorage');
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'directory-1' };

        await writeDeviceLocalStorageString('account_directory_auth_credentials', '{"bad":true}');
        await expect(accountDirectoryCredentialStorage.set(target, { token: 'replacement' })).resolves.toBe(false);
        expect(storage.get('account_directory_auth_credentials')).toBe('{"bad":true}');

        readFailure = new Error('secure storage unavailable');
        await expect(accountDirectoryCredentialStorage.remove(target)).resolves.toBe(false);
        expect(storage.get('account_directory_auth_credentials')).toBe('{"bad":true}');
    });

    it('preflights both custody records before logout mutates either key', async () => {
        const { accountDirectoryCredentialStorage } = await import('./accountDirectoryCredentialStorage');
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'directory-1' };
        await accountDirectoryCredentialStorage.set(target, { token: 'directory-token' });
        storage.set('pending_account_directory_auth', '{"bad":true}');

        await expect(accountDirectoryCredentialStorage.logout(target)).resolves.toBe(false);
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({
            kind: 'valid',
            value: { token: 'directory-token' },
        });
        expect(storage.get('pending_account_directory_auth')).toBe('{"bad":true}');
    });

    it('scopes both Directory custody keys through the canonical storage-scope owner', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = 'profile-a';
        const { accountDirectoryCredentialStorage } = await import('./accountDirectoryCredentialStorage');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'srv_directory-1' };
        const now = Date.now();

        await accountDirectoryCredentialStorage.set(target, { token: 'directory-token' });
        await TokenStorage.setPendingAccountDirectoryAuth({
            ...target,
            credentialTarget: 'account_directory',
            provider: 'github',
            purpose: 'account_directory',
            pending: 'pending-1',
            createdAt: now,
            expiresAt: now + 60_000,
        });

        expect(storage.has('account_directory_auth_credentials__profile-a')).toBe(true);
        expect(storage.has('pending_account_directory_auth__profile-a')).toBe(true);
        expect(storage.has('account_directory_auth_credentials')).toBe(false);
        expect(storage.has('pending_account_directory_auth')).toBe(false);
    });
});
