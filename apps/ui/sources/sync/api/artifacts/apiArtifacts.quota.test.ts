import { describe, expect, it } from 'vitest';
import { createArtifact, updateArtifact } from './apiArtifacts';

const refusal = { error: 'quota_exceeded', budget: 'document', limitBytes: 1_048_576, usedBytes: 1_363_148 };

describe('Artifact storage budget refusals', () => {
    it('names the refused budget and its sizes on create and update, without retrying', async () => {
        let calls = 0;
        const request = async () => { calls += 1; return Response.json(refusal, { status: 413 }); };
        await expect(createArtifact({ token: 't' }, { id: 'a1', header: 'h', body: 'b', dataEncryptionKey: 'k' }, { request }))
            .rejects.toMatchObject({ status: 413, code: 'quota_exceeded', quota: { budget: 'document', limitBytes: 1_048_576, usedBytes: 1_363_148 } });
        await expect(updateArtifact({ token: 't' }, 'a1', { body: 'b', expectedBodyVersion: 2 }, { request }))
            .rejects.toMatchObject({ status: 413, code: 'quota_exceeded', quota: { budget: 'document', limitBytes: 1_048_576, usedBytes: 1_363_148 } });
        expect(calls).toBe(2);
    });
});
