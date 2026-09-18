import { describe, expect, it } from 'vitest';

import { createSaplingScmBackendRegistration } from './backend.js';

describe('Sapling SCM backend capability projection', () => {
    it('derives unavailable leaves through the canonical repository-mode policy', async () => {
        const describeBackend = createSaplingScmBackendRegistration().handlers.detection?.describeBackend;
        expect(describeBackend).toEqual(expect.any(Function));
        if (!describeBackend) return;

        const response = await describeBackend({
            context: {
                cwd: '/repo',
                projectKey: 'machine:/repo',
                detection: { isRepo: false, rootPath: null, mode: null },
            },
        });

        expect(response.capabilities?.readStatus).toBe(false);
        expect(response.capabilities?.writeCommit).toBe(false);
    });
});
