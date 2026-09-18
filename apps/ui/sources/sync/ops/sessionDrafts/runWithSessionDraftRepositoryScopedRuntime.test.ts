import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runWithAuthority: vi.fn(),
    getServerFeaturesSnapshot: vi.fn(),
    fetchMode: vi.fn(),
    createTransport: vi.fn(),
    createCipher: vi.fn(),
    resolveMaterial: vi.fn(),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope', () => ({
    runWithServerRequestAuthorityForServerAccountScope: mocks.runWithAuthority,
}));
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: mocks.getServerFeaturesSnapshot,
}));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/account/apiAccountEncryptionMode')>(),
    fetchAccountEncryptionMode: mocks.fetchMode,
}));
vi.mock('@/sync/api/account/apiSessionDrafts', () => ({ createApiSessionDraftsTransport: mocks.createTransport }));
vi.mock('@/sync/encryption/sessionDraftEncryption', () => ({ createSessionDraftCipher: mocks.createCipher }));
vi.mock('@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials', () => ({
    resolveAccountScopedCryptoMaterialFromCredentials: mocks.resolveMaterial,
}));
vi.mock('@/platform/cryptoRandom', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }));

import { runWithSessionDraftRepositoryScopedRuntime } from './runWithSessionDraftRepositoryScopedRuntime';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';

const scope = { serverId: 'home-b', accountId: 'account-b' } as const;
const credentials = { token: 'bearer-b', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } as const;

function binding(isCurrent: () => boolean) {
    return {
        serverId: scope.serverId,
        accountId: scope.accountId,
        scope,
        revision: 1,
        isCurrent,
        onRetire: () => ({ dispose() {} }),
    };
}

describe('runWithSessionDraftRepositoryScopedRuntime', () => {
    beforeEach(() => {
        mocks.runWithAuthority.mockReset();
        mocks.getServerFeaturesSnapshot.mockReset();
        mocks.fetchMode.mockReset();
        mocks.createTransport.mockReset();
        mocks.createCipher.mockReset();
        mocks.resolveMaterial.mockReset();
        mocks.getServerFeaturesSnapshot.mockResolvedValue({
            status: 'ready',
            features: createRootLayoutFeaturesResponse({
                features: { sessions: { drafts: { enabled: true } } },
            }),
        });
        mocks.fetchMode.mockResolvedValue({ mode: 'e2ee', updatedAt: 1 });
        mocks.resolveMaterial.mockReturnValue({ type: 'legacy', secret: new Uint8Array(32) });
        mocks.createTransport.mockReturnValue({ kind: 'transport-b' });
        mocks.createCipher.mockReturnValue({ kind: 'cipher-b' });
        mocks.runWithAuthority.mockImplementation(async (params, operation) => operation({
            scope,
            context: { scope: 'scoped', credentials },
            request: params.activeRequest,
            release: async () => undefined,
        }));
    });

    it('composes the exact Home transport and Account-mode cipher for one current invocation', async () => {
        const requestB = vi.fn(async () => new Response('{}'));
        const operation = vi.fn(async () => 'hydrated');

        await expect(runWithSessionDraftRepositoryScopedRuntime({
            binding: binding(() => true),
            activeRequest: requestB,
            operation,
        })).resolves.toBe('hydrated');

        expect(mocks.runWithAuthority).toHaveBeenCalledWith(
            { scope, activeRequest: requestB },
            expect.any(Function),
        );
        expect(mocks.getServerFeaturesSnapshot).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'home-b' }));
        expect(mocks.fetchMode).toHaveBeenCalledWith(credentials, { request: expect.any(Function) });
        expect(mocks.createTransport).toHaveBeenCalledWith({ request: expect.any(Function) });
        expect(mocks.createCipher).toHaveBeenCalledWith(expect.objectContaining({
            accountMode: 'e2ee',
            accountCryptoMaterial: { type: 'legacy', secret: expect.any(Uint8Array) },
        }));
        expect(operation).toHaveBeenCalledWith(expect.objectContaining({
            scope,
            runtime: { transport: { kind: 'transport-b' }, cipher: { kind: 'cipher-b' } },
        }));
    });

    it('does not compose or invoke a draft runtime when the exact Home does not support drafts', async () => {
        mocks.getServerFeaturesSnapshot.mockResolvedValue({
            status: 'ready',
            features: createRootLayoutFeaturesResponse({
                features: { sessions: { drafts: { enabled: false } } },
            }),
        });
        const operation = vi.fn();

        await expect(runWithSessionDraftRepositoryScopedRuntime({
            binding: binding(() => true),
            activeRequest: vi.fn(),
            operation,
        })).resolves.toBeNull();

        expect(mocks.fetchMode).not.toHaveBeenCalled();
        expect(mocks.createTransport).not.toHaveBeenCalled();
        expect(operation).not.toHaveBeenCalled();
    });

    it('publishes no runtime after the exact credential binding retires during mode resolution', async () => {
        let current = true;
        mocks.fetchMode.mockImplementation(async () => {
            current = false;
            return { mode: 'plain', updatedAt: 1 };
        });
        const operation = vi.fn();

        await expect(runWithSessionDraftRepositoryScopedRuntime({
            binding: binding(() => current),
            activeRequest: vi.fn(),
            operation,
        })).resolves.toBeNull();

        expect(mocks.createTransport).not.toHaveBeenCalled();
        expect(operation).not.toHaveBeenCalled();
    });
});
