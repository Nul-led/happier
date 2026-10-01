import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerFeaturesSnapshot: vi.fn(),
    serverFetch: vi.fn(),
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: mocks.getServerFeaturesSnapshot,
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch: mocks.serverFetch,
}));

import { deleteArtifact, fetchArtifact, fetchArtifacts } from './apiArtifacts';

const authority = { ownerAccountId: 'account-a', access: 'owner', encryptionMode: 'plain' };

describe('deleteArtifact stored-content compatibility', () => {
    beforeEach(() => {
        mocks.getServerFeaturesSnapshot.mockReset();
        mocks.serverFetch.mockReset();
    });

    it('selects only the captured owner for an Account migration, not received document grants', async () => {
        mocks.serverFetch.mockResolvedValueOnce(new Response(JSON.stringify([
            { id: 'owned', ...authority },
            { id: 'received', ...authority, ownerAccountId: 'account-b', access: 'admin' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const rows = await fetchArtifacts({ token: 'token' }, { retry: 'none', ownerAccountId: 'account-a' });
        expect(rows.map(row => row.id)).toEqual(['owned']);
    });

    it.each([{}, { ownerAccountId: 'account-a', access: 'owner' }, { ...authority, access: 'invalid' }])(
        'refuses incomplete or invalid current Artifact authority before returning read/list content', async (projection) => {
            const row = { id: 'private', header: 'private-header', ...projection };
            mocks.serverFetch.mockResolvedValueOnce(new Response(JSON.stringify(row), { status: 200 }));
            await expect(fetchArtifact({ token: 'token' }, 'private', { retry: 'none' }))
                .rejects.toMatchObject({ code: 'artifact_content_unavailable' });
            mocks.serverFetch.mockResolvedValueOnce(new Response(JSON.stringify([row]), { status: 200 }));
            await expect(fetchArtifacts({ token: 'token' }, { retry: 'none' }))
                .rejects.toMatchObject({ code: 'artifact_content_unavailable' });
        });

    it('deletes by id without reading stored content or requiring current protocol support', async () => {
        mocks.serverFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
        mocks.getServerFeaturesSnapshot.mockResolvedValue({
            status: 'ready',
            features: {
                capabilities: {
                    encryption: {
                        storagePolicy: 'optional',
                    },
                },
            },
        });

        await expect(deleteArtifact(
            { token: 'token-only' },
            'artifact-plain',
            { retry: 'none' },
        )).resolves.toBeUndefined();

        expect(mocks.serverFetch).toHaveBeenCalledTimes(1);
        expect(mocks.serverFetch).toHaveBeenCalledWith(
            '/v1/artifacts/artifact-plain',
            expect.objectContaining({
                method: 'DELETE',
                headers: expect.objectContaining({
                    Authorization: 'Bearer token-only',
                }),
            }),
            expect.objectContaining({ includeAuth: false }),
        );
        expect(mocks.getServerFeaturesSnapshot).not.toHaveBeenCalled();
    });

    it('preserves legacy E2EE Artifact deletion without requiring the marker capability', async () => {
        mocks.serverFetch
            .mockResolvedValueOnce(new Response(JSON.stringify({
                id: 'artifact-e2ee',
                header: 'encrypted-header',
                headerVersion: 1,
                body: 'encrypted-body',
                bodyVersion: 1,
                dataEncryptionKey: 'released-encrypted-data-key',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));

        await expect(deleteArtifact(
            { token: 'released-keyed-client', secret: 'real-e2ee-material' },
            'artifact-e2ee',
            { retry: 'none' },
        )).resolves.toBeUndefined();

        expect(mocks.getServerFeaturesSnapshot).not.toHaveBeenCalled();
        expect(
            mocks.serverFetch.mock.calls.filter(([, init]) =>
                (init as RequestInit | undefined)?.method === 'DELETE'),
        ).toHaveLength(1);
    });
});
