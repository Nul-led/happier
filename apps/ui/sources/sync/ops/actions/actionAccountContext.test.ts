import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    accountMode: 'plain' as 'plain' | 'e2ee',
    credentials: { token: 'token-a' },
    encryption: { marker: 'exact-home-encryption' },
    createEncryption: vi.fn(),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: vi.fn(async () => boundary.credentials),
    },
    subscribeHomeCredentialMutations: vi.fn(() => () => undefined),
}));
vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: (...args: unknown[]) => boundary.createEncryption(...args),
}));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: vi.fn(async () => ({ mode: boundary.accountMode, updatedAt: 1 })),
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeCurrentness: vi.fn(() => ({
        isCurrent: () => true,
        onRetire: () => ({ dispose: () => undefined }),
    })),
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: vi.fn(() => ({ serverId: 'home-a' })),
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    areServerProfileIdentifiersEquivalent: vi.fn(() => true),
    getServerProfileById: vi.fn(() => ({
        id: 'home-a',
        serverUrl: 'https://home-a.example.test',
        serverIdentityId: 'home-identity-a',
    })),
    resolveServerProfileScopeIdForIdentifier: vi.fn((serverId: string) => serverId),
}));
vi.mock('@/sync/domains/settings/scope/accountSettingsScope', () => ({
    areAccountSettingsScopesEqual: vi.fn(() => true),
}));
vi.mock('@/sync/domains/state/storage', () => ({
    storage: {
        getState: () => ({
            settingsScope: { serverId: 'home-a', accountId: 'account-a' },
            settings: { schemaVersion: 2 },
        }),
    },
}));
vi.mock('@/sync/domains/state/accountSettingsPersistence', () => ({
    loadAccountSettings: vi.fn(() => ({ settings: {}, version: null })),
}));
vi.mock('@/sync/engine/settings/accountSettingsBaseline', () => ({
    readAccountSettingsBaseline: vi.fn(async () => ({ raw: {} })),
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedTransport', () => ({
    resolveServerScopedTransport: vi.fn(),
}));
vi.mock('@/utils/auth/parseToken', () => ({
    parseToken: vi.fn(() => 'account-a'),
}));

import { captureActionAccountContext } from './actionAccountContext';

describe('captureActionAccountContext encryption authority', () => {
    beforeEach(() => {
        boundary.accountMode = 'plain';
        boundary.createEncryption.mockReset();
        boundary.createEncryption.mockResolvedValue(boundary.encryption);
    });

    it('exposes no fabricated encryption material for a Plain Account', async () => {
        const context = await captureActionAccountContext('home-a');
        try {
            expect(context.encryption).toBeNull();
            expect(boundary.createEncryption).not.toHaveBeenCalled();
        } finally {
            context.dispose();
        }
    });

    it('exposes the exact encryption instance resolved for the captured E2EE Home', async () => {
        boundary.accountMode = 'e2ee';

        const context = await captureActionAccountContext('home-a');
        try {
            expect(context.encryption).toBe(boundary.encryption);
            expect(boundary.createEncryption).toHaveBeenCalledWith(boundary.credentials);
        } finally {
            context.dispose();
        }
    });
});
