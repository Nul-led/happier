import { describe, expect, it } from 'vitest';

import { settlePluginRuntimeCompositionCleanup } from './activationAssembly';

describe('plugin runtime activation composition cleanup', () => {
    it('preserves every cleanup failure in one AggregateError', async () => {
        const first = new Error('activation cleanup failed');
        const second = new Error('invocation cleanup failed');

        const outcome = settlePluginRuntimeCompositionCleanup([
            Promise.reject(first),
            Promise.reject(second),
        ], 'combined cleanup failed');

        await expect(outcome).rejects.toMatchObject({
            message: 'combined cleanup failed',
            errors: [first, second],
        });
    });

    it('includes the activation failure before cleanup failures', async () => {
        const activation = new Error('activation failed');
        const cleanup = new Error('cleanup failed');

        const outcome = settlePluginRuntimeCompositionCleanup([
            Promise.reject(cleanup),
        ], 'activation and cleanup failed', activation);

        await expect(outcome).rejects.toMatchObject({
            errors: [activation, cleanup],
        });
    });

    it('rethrows the activation failure when cleanup succeeds', async () => {
        const activation = new Error('activation failed');

        await expect(settlePluginRuntimeCompositionCleanup(
            [Promise.resolve()],
            'activation cleanup failed',
            activation,
        )).rejects.toBe(activation);
    });
});
