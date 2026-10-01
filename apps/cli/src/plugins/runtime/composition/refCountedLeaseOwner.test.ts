import { describe, expect, it, vi } from 'vitest';

import { createRefCountedLeaseOwner } from './refCountedLeaseOwner';

describe('createRefCountedLeaseOwner', () => {
    it('disposes after the final lease and forwards its release options', async () => {
        const dispose = vi.fn(async (_options?: Readonly<{ reason: string }>) => undefined);
        const owner = createRefCountedLeaseOwner({
            payload: Object.freeze({ value: 'payload' }),
            disposedError: 'disposed',
            dispose,
        });
        const first = owner.retain();
        const second = first.retain();

        await first.release({ reason: 'not-final' });
        expect(dispose).not.toHaveBeenCalled();

        await second.release({ reason: 'final' });
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledWith({ reason: 'final' });
        expect(() => owner.retain()).toThrow('disposed');
    });

    it('makes each lease release idempotent and shares one in-flight disposal', async () => {
        let finishDisposal!: () => void;
        const dispose = vi.fn(() => new Promise<void>((resolve) => {
            finishDisposal = resolve;
        }));
        const owner = createRefCountedLeaseOwner({
            payload: Object.freeze({}),
            disposedError: 'disposed',
            dispose,
        });
        const lease = owner.retain();

        const firstRelease = lease.release();
        const duplicateRelease = lease.release();
        expect(dispose).toHaveBeenCalledTimes(1);

        finishDisposal();
        await Promise.all([firstRelease, duplicateRelease]);
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});
