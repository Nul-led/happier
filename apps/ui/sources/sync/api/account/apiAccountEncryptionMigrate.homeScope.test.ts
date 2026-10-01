import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { registerStorageStateReader } from '@/sync/domains/state/storageStateReaderBridge';
import { retireActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import type { StorageState } from '@/sync/store/types';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { fetchArtifacts } from '@/sync/api/artifacts/apiArtifacts';
import { AccountEncryptionMigrateRequestSchema, migrateAccountEncryptionMode } from './apiAccountEncryptionMigrate';
import { captureAccountSettingsRequest } from './accountSettingsRequest';

const credentials = { token: 'home-a-migration-token' };
const migration = AccountEncryptionMigrateRequestSchema.parse({
    toMode: 'plain', expectedAccountVersion: 3,
    expectedSigningKeyFingerprint: 'aemk1_signing', expectedContentKeyFingerprint: 'aemk1_content',
    expectedSettingsVersion: 0, settingsContent: { t: 'plain', v: { migrationPrivateValue: 'only-home-a' } },
    connectedServices: { action: 'assert_empty' }, automations: { action: 'assert_empty' },
    machines: { action: 'assert_empty' }, todos: { action: 'assert_empty' },
    artifacts: { action: 'assert_empty' }, sessions: { action: 'assert_empty' },
    reviewComments: { action: 'assert_empty' }, sessionOrganization: { action: 'assert_empty' },
    pets: { action: 'assert_empty' },
});
const success = { success: true, mode: 'plain', accountVersion: 4, settingsVersion: 1 };
const http = vi.fn<typeof fetch>();
let sequence = 0;

async function activateHome(name: string) {
    const serverUrl = `https://${name}-${sequence}.example.test`;
    const profile = await upsertAndActivateServer({ serverUrl, name });
    const scope = { serverId: profile.id, accountId: `account-${name}` };
    // The real Account lifetime reads this boundary's registered persisted state.
    registerStorageStateReader(() => ({ profileScope: scope }) as StorageState);
    await TokenStorage.setCredentialsForServerUrl(serverUrl, { serverId: profile.id }, name === 'home-a' ? credentials : { token: 'home-b-token' });
    return { target: { serverUrl, serverId: profile.id }, scope };
}

beforeEach(() => {
    sequence += 1;
    retireActiveServerAccountScopeLifetime();
    http.mockReset();
    setRuntimeFetch(http);
});
afterEach(() => {
    retireActiveServerAccountScopeLifetime();
    resetRuntimeFetch();
});

describe('Account encryption migration Home binding', () => {
    it('replaces only the initiating Home credential after a committed migration, not a new Account on that Home', async () => {
        const homeA = await activateHome('home-a');
        await activateHome('home-b');
        await expect(TokenStorage.setCredentialsForServerUrl(
            homeA.target.serverUrl, { serverId: homeA.target.serverId, expectedCredentials: credentials }, { token: credentials.token, secret: 'new-key' },
        )).resolves.toBe(true);
        const replacement = { token: 'new-account-on-home-a' };
        await TokenStorage.setCredentialsForServerUrl(homeA.target.serverUrl, { serverId: homeA.target.serverId }, replacement);
        await expect(TokenStorage.setCredentialsForServerUrl(
            homeA.target.serverUrl, { serverId: homeA.target.serverId, expectedCredentials: credentials }, { token: credentials.token },
        )).resolves.toBe(false);
        await expect(TokenStorage.getCredentialsForServerUrl(homeA.target.serverUrl, { serverId: homeA.target.serverId })).resolves.toEqual(replacement);
    });

    it('keeps the plaintext mutation on the captured Home while the active Home changes', async () => {
        const homeA = await activateHome('home-a');
        let finishMutation!: (response: Response) => void;
        http.mockImplementation(async () => new Promise<Response>((resolve) => { finishMutation = resolve; }));
        const pending = migrateAccountEncryptionMode(credentials, migration, { target: homeA.target, retry: 'none' });
        await vi.waitFor(() => expect(finishMutation).toBeTypeOf('function'));
        await activateHome('home-b');
        finishMutation(Response.json(success));
        await expect(pending).resolves.toEqual(success);

        const mutations = http.mock.calls.filter(([url]) => String(url).endsWith('/v1/account/encryption/migrate'));
        expect(mutations).toHaveLength(1);
        expect(String(mutations[0]![0])).toBe(`${homeA.target.serverUrl}/v1/account/encryption/migrate`);
        expect(new Headers(mutations[0]![1]?.headers).get('Authorization')).toBe(`Bearer ${credentials.token}`);
        expect(JSON.parse(String(mutations[0]![1]?.body))).toEqual(migration);
        expect(http.mock.calls.every(([url]) => String(url).startsWith(homeA.target.serverUrl))).toBe(true);
    });

    it('rejects a captured settings intent retired during preparation before any migration mutation', async () => {
        const homeA = await activateHome('home-a');
        const captured = await captureAccountSettingsRequest({ credentials, settingsScope: homeA.scope });
        expect(captured).not.toBeNull();
        http.mockImplementation(async () => Response.json(createRootLayoutFeaturesResponse()));
        await activateHome('home-b');
        try {
            await expect(migrateAccountEncryptionMode(credentials, migration, {
                target: homeA.target, request: captured!.request, retry: 'none',
            })).rejects.toThrow();
            expect(http.mock.calls.some(([url]) => String(url).endsWith('/v1/account/encryption/migrate'))).toBe(false);
            expect(http.mock.calls.every(([url]) => String(url).startsWith(homeA.target.serverUrl))).toBe(true);
        } finally {
            captured!.dispose();
        }
    });

    it('retires preparation when the initiating Home credentials change before the Account projection catches up', async () => {
        const homeA = await activateHome('home-a');
        const captured = await captureAccountSettingsRequest({ credentials, settingsScope: homeA.scope });
        expect(captured).not.toBeNull();
        http.mockImplementation(async () => Response.json(success));
        try {
            await TokenStorage.setCredentialsForServerUrl(homeA.target.serverUrl, { serverId: homeA.target.serverId }, {
                token: credentials.token, secret: 'replacement-account-material',
            });
            expect(captured!.isCurrent()).toBe(false);
            await expect(captured!.request('/v1/account/encryption/migrate', {
                method: 'POST', body: JSON.stringify(migration),
            })).rejects.toThrow();
            expect(http).not.toHaveBeenCalled();
        } finally {
            captured!.dispose();
        }
    });

    it('does not send an inventory bearer to the newly selected Home after preparation retires', async () => {
        const homeA = await activateHome('home-a');
        const captured = await captureAccountSettingsRequest({ credentials, settingsScope: homeA.scope });
        expect(captured).not.toBeNull();
        http.mockImplementation(async () => Response.json([]));
        await activateHome('home-b');
        try {
            await expect(fetchArtifacts(credentials, { request: captured!.request, retry: 'none' })).rejects.toThrow();
            expect(http).not.toHaveBeenCalled();
        } finally {
            captured!.dispose();
        }
    });

    it('preserves a received mutation acknowledgement when the Home changes during body decoding', async () => {
        const homeA = await activateHome('home-a');
        const captured = await captureAccountSettingsRequest({ credentials, settingsScope: homeA.scope });
        expect(captured).not.toBeNull();
        let finishBody!: (body: unknown) => void;
        http.mockImplementation(async (url) => {
            if (String(url).endsWith('/v1/features')) return Response.json(createRootLayoutFeaturesResponse());
            const response = Response.json(success);
            response.json = () => new Promise((resolve) => { finishBody = resolve; });
            return response;
        });
        try {
            const pending = migrateAccountEncryptionMode(credentials, migration, {
                target: homeA.target, request: captured!.request, retry: 'none',
            });
            await vi.waitFor(() => expect(finishBody).toBeTypeOf('function'));
            await activateHome('home-b');
            finishBody(success);
            await expect(pending).resolves.toEqual(success);
            expect(captured!.isCurrent()).toBe(false);
            expect(http.mock.calls.every(([url]) => String(url).startsWith(homeA.target.serverUrl))).toBe(true);
        } finally {
            captured!.dispose();
        }
    });
});
