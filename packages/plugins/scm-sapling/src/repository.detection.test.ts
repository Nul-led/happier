import { describe, expect, it } from 'vitest';

import { SCM_OPERATION_ERROR_CODES } from '@happier-dev/plugin-sdk/scm';
import { runWithBackendRuntimeServices } from '@happier-dev/plugin-sdk/scm/backend';

import { detectSaplingRepo } from './repository.js';

describe('Sapling repository detection', () => {
    it.each([
        'abort: repository requires unknown features: unsupported-format',
        'abort: Permission denied: /repo/.sl',
    ])('preserves a completed refusal as unavailable: %s', async (stderr) => {
        const detection = runWithBackendRuntimeServices({
            async runCommand(input) {
                return input.args[0] === '--version'
                    ? { success: true, stdout: 'Sapling 0.2\n', stderr: '', exitCode: 0 }
                    : { success: false, stdout: '', stderr, exitCode: 255 };
            },
        }, () => detectSaplingRepo({ cwd: '/repo' }));

        await expect(detection).rejects.toMatchObject({
            errorCode: SCM_OPERATION_ERROR_CODES.BACKEND_UNAVAILABLE,
        });
    });

    it('accepts the completed no-repository diagnostic as a negative answer', async () => {
        const detection = await runWithBackendRuntimeServices({
            async runCommand(input) {
                if (input.args[0] === '--version') {
                    return { success: true, stdout: 'Sapling 0.2\n', stderr: '', exitCode: 0 };
                }
                return {
                    success: false,
                    stdout: '',
                    // Sapling's own eden/scm/tests/test-root.t pins this diagnostic.
                    stderr: "abort: '/repo' is not inside a repository, but this command requires a repository!\n(use 'cd' to go to a directory inside a repository and try again)\n",
                    exitCode: 255,
                };
            },
        }, () => detectSaplingRepo({ cwd: '/repo' }));

        expect(detection).toEqual({ isRepo: false, rootPath: null, mode: null });
    });
});
