import { describe, expect, it } from 'vitest';
import { deleteArtifact } from './apiArtifacts';

describe('Artifact revision deletion', () => {
    it('carries the observed revision and cancellation to the existing HTTP owner', async () => {
        const controller = new AbortController();
        let requestPath: string | null = null;
        let requestSignal: AbortSignal | null | undefined;
        await deleteArtifact({ token: 'plain-token' }, 'b1', {
            expectedRevision: { headerVersion: 3, bodyVersion: 5 }, signal: controller.signal,
            request: async (path, init) => {
                requestPath = path; requestSignal = init?.signal;
                return Response.json({ success: true });
            },
        });
        expect(requestPath).toBe('/v1/artifacts/b1/revision/3/5');
        expect(requestSignal).toBe(controller.signal);
    });

    it('returns a typed conflict instead of deleting or retrying another revision', async () => {
        await expect(deleteArtifact({ token: 'plain-token' }, 'b1', {
            expectedRevision: { headerVersion: 3, bodyVersion: 5 },
            request: async () => Response.json({ error: 'version-mismatch' }, { status: 409 }),
        })).rejects.toMatchObject({ status: 409, code: 'version_mismatch' });
    });
});
