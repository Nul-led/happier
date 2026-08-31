import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTokenStorageWebPlatformMocks } from './tokenStorage.testHelpers';
import { installLocalStorageMock } from './tokenStorage.web.testHelpers';
import { encodeBase64 } from '@/encryption/base64';

installTokenStorageWebPlatformMocks();

const HOME_URL_A = 'http://127.0.0.1:3005';
const HOME_URL_B = 'http://127.0.0.1:43110';
const HOME_IDENTITY_A = 'srv_home_a_identity';
const HOME_IDENTITY_B = 'srv_home_b_identity';
const PENDING_SEED_KEY_PREFIX = 'pending_personal_home_bootstrap_seed';

function seed32(fill: number): Uint8Array {
    return new Uint8Array(32).fill(fill);
}

function storedPendingSeedRecords(store: Map<string, string>): Array<Record<string, unknown>> {
    return [...store.entries()]
        .filter(([key]) => key.includes(PENDING_SEED_KEY_PREFIX))
        .map(([, value]) => JSON.parse(value) as Record<string, unknown>);
}

describe('TokenStorage pending Personal Home bootstrap seed custody', () => {
    let restoreLocalStorage: (() => void) | null = null;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreLocalStorage?.();
        restoreLocalStorage = null;
    });

    it('persists a versioned base64url record and reads back the exact 32 seed bytes', async () => {
        const storage = installLocalStorageMock();
        restoreLocalStorage = storage.restore;
        const { TokenStorage } = await import('./tokenStorage');

        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A)).resolves.toBeNull();

        const seed = seed32(7);
        await expect(
            TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_A, {}, seed),
        ).resolves.toBe(true);
        await expect(
            TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A),
        ).resolves.toEqual(seed);

        // The custody record is versioned and carries only the base64url seed bytes.
        const records = storedPendingSeedRecords(storage.store);
        expect(records).toHaveLength(1);
        expect(Object.keys(records[0]!).sort()).toEqual(['seedBase64Url', 'v']);
        expect(records[0]).toMatchObject({ v: 1, seedBase64Url: encodeBase64(seed, 'base64url') });
        expect(records[0]!.seedBase64Url).toMatch(/^[A-Za-z0-9_-]{43}$/);

        // Bootstrap custody is never a Home credential and never carries a secret field.
        const credentialKeys = [...storage.store.keys()].filter((key) => key.includes('auth_credentials'));
        expect(credentialKeys).toEqual([]);
    });

    it('rejects seeds that are not exactly 32 bytes without writing custody', async () => {
        const storage = installLocalStorageMock();
        restoreLocalStorage = storage.restore;
        const { TokenStorage } = await import('./tokenStorage');

        for (const length of [0, 31, 33, 64]) {
            await expect(
                TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_A, {}, new Uint8Array(length).fill(1)),
            ).resolves.toBe(false);
        }
        expect(storedPendingSeedRecords(storage.store)).toEqual([]);
        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A)).resolves.toBeNull();
    });

    it('reads corrupted or foreign custody records as absent instead of consuming them', async () => {
        const storage = installLocalStorageMock();
        restoreLocalStorage = storage.restore;
        const { TokenStorage } = await import('./tokenStorage');

        const validRecord = { v: 1, seedBase64Url: encodeBase64(seed32(3), 'base64url') };
        const corruptedRecords = [
            JSON.stringify({ v: 2, seedBase64Url: validRecord.seedBase64Url }),
            JSON.stringify({ v: 1, seedBase64Url: encodeBase64(new Uint8Array(31).fill(3), 'base64url') }),
            JSON.stringify({ v: 1, seedBase64Url: 'not base64url!!' }),
            JSON.stringify({ v: 1, seedBase64Url: validRecord.seedBase64Url, secret: 'no-secrets-here' }),
            JSON.stringify({ seedBase64Url: validRecord.seedBase64Url }),
            'not json at all',
        ];

        for (const [index, corrupted] of corruptedRecords.entries()) {
            storage.store.clear();
            const key = `${PENDING_SEED_KEY_PREFIX}__srv_corrupted_${index}`;
            storage.store.set(key, corrupted);
            await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A)).resolves.toBeNull();
        }
    });

    it('never overwrites an unreadable existing custody record with a newly generated seed', async () => {
        const storage = installLocalStorageMock();
        restoreLocalStorage = storage.restore;
        const { TokenStorage } = await import('./tokenStorage');

        await expect(
            TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_A, {}, seed32(3)),
        ).resolves.toBe(true);
        const [custodyKey] = [...storage.store.keys()].filter((key) => key.includes(PENDING_SEED_KEY_PREFIX));
        expect(custodyKey).toBeTruthy();
        storage.store.set(custodyKey!, JSON.stringify({ v: 1, seedBase64Url: 'corrupt' }));

        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A)).resolves.toBeNull();
        await expect(
            TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_A, {}, seed32(4)),
        ).resolves.toBe(false);
        expect(storage.store.get(custodyKey!)).toBe(JSON.stringify({ v: 1, seedBase64Url: 'corrupt' }));
    });

    it('isolates pending seeds by explicit canonical Home origin', async () => {
        const storage = installLocalStorageMock();
        restoreLocalStorage = storage.restore;
        const { TokenStorage } = await import('./tokenStorage');

        const seedA = seed32(1);
        const seedB = seed32(2);
        await expect(
            TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_A, {}, seedA),
        ).resolves.toBe(true);
        await expect(
            TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_B, {}, seedB),
        ).resolves.toBe(true);

        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A)).resolves.toEqual(seedA);
        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_B)).resolves.toEqual(seedB);

        // A different origin cannot consume Home A's seed, and clearing Home A leaves Home B intact.
        await expect(TokenStorage.clearPendingPersonalHomeBootstrapSeed(HOME_URL_A)).resolves.toBe(true);
        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A)).resolves.toBeNull();
        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_B)).resolves.toEqual(seedB);
    });

    it('isolates pending seeds by stable Home identity at the same canonical origin', async () => {
        const storage = installLocalStorageMock();
        restoreLocalStorage = storage.restore;

        vi.doMock('@/sync/domains/server/serverProfiles', () => ({
            areServerProfileIdentifiersEquivalent: (left: unknown, right: unknown) => String(left) === String(right),
            getActiveServerId: () => null,
            getActiveServerUrl: () => '',
            listServerProfiles: () => [
                { id: 'profile-a', serverUrl: HOME_URL_A, serverIdentityId: HOME_IDENTITY_A, legacyServerIds: [] },
                { id: 'profile-b', serverUrl: HOME_URL_A, serverIdentityId: HOME_IDENTITY_B, legacyServerIds: [] },
            ],
        }));

        const { TokenStorage } = await import('./tokenStorage');
        const seedA = seed32(5);
        const seedB = seed32(6);
        await expect(
            TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_A, { serverId: HOME_IDENTITY_A }, seedA),
        ).resolves.toBe(true);
        await expect(
            TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL_A, { serverId: HOME_IDENTITY_B }, seedB),
        ).resolves.toBe(true);

        await expect(
            TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A, { serverId: HOME_IDENTITY_A }),
        ).resolves.toEqual(seedA);
        await expect(
            TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A, { serverId: HOME_IDENTITY_B }),
        ).resolves.toEqual(seedB);

        await expect(
            TokenStorage.clearPendingPersonalHomeBootstrapSeed(HOME_URL_A, { serverId: HOME_IDENTITY_A }),
        ).resolves.toBe(true);
        await expect(
            TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A, { serverId: HOME_IDENTITY_A }),
        ).resolves.toBeNull();
        await expect(
            TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL_A, { serverId: HOME_IDENTITY_B }),
        ).resolves.toEqual(seedB);
        expect(storedPendingSeedRecords(storage.store)).toHaveLength(1);
    });

});
