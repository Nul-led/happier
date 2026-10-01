import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_API_TOKEN_SELF_HTTP_PATH_V1, API_TOKEN_FULL_GRANT_V1 } from '@happier-dev/protocol';
import { createFakeRouteApp, createReplyStub, getRouteHandler } from '../../testkit/routeHarness';

// Persistent Account storage is the system boundary; the real route projects its authoritative mode.
const storage = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: { account: storage } }));
import { registerAccountApiTokenManagementRoutes } from './registerAccountApiTokenManagementRoutes';

describe('scoped self Account mode', () => {
    it('projects persisted mode without depending on client encryption material', async () => {
        const app = createFakeRouteApp();
        registerAccountApiTokenManagementRoutes(app as never);
        const handler = getRouteHandler(app, 'GET', ACCOUNT_API_TOKEN_SELF_HTTP_PATH_V1);
        const principal = { accountId: 'a', credentialId: '2c67deea-5ae7-4706-9ad6-b5b992df1cba', parentTokenId: null,
            expiresAt: null, grant: API_TOKEN_FULL_GRANT_V1, embedConfig: null };
        for (const encryptionMode of ['plain', 'e2ee']) {
            storage.findUniqueOrThrow.mockResolvedValue({ encryptionMode });
            const reply = createReplyStub();
            await handler({ userId: 'a', authTokenKind: 'api_token', apiTokenPrincipal: principal }, reply);
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ accountEncryptionMode: encryptionMode }));
        }
    });
});
