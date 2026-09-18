import { describe, expect, it, vi } from 'vitest';

import { createCreatedNewSessionCompletion } from './completeCreatedNewSession';

describe('createCreatedNewSessionCompletion', () => {
    it('keeps an already-presented Session open while its post-create transfer retries', async () => {
        const followUp = vi.fn()
            .mockRejectedValueOnce(new Error('attachment upload failed'))
            .mockResolvedValueOnce(undefined);
        const present = vi.fn(async () => 'opened' as const);
        const clearCapturedDraft = vi.fn(async () => undefined);
        const completion = createCreatedNewSessionCompletion({ followUp, present, clearCapturedDraft });

        await expect(completion.present()).resolves.toBe('opened');
        await expect(completion.complete()).rejects.toMatchObject({ stage: 'follow_up' });
        expect(present).toHaveBeenCalledTimes(1);
        expect(clearCapturedDraft).not.toHaveBeenCalled();

        await expect(completion.complete()).resolves.toBe('opened');
        expect(followUp).toHaveBeenCalledTimes(2);
        expect(present).toHaveBeenCalledTimes(1);
        expect(clearCapturedDraft).toHaveBeenCalledTimes(1);
    });

    it('retries from the failed ordinary follow-up without navigating or clearing early', async () => {
        const followUp = vi.fn()
            .mockRejectedValueOnce(new Error('attachment upload failed'))
            .mockResolvedValueOnce(undefined);
        const present = vi.fn(async () => 'opened' as const);
        const clearCapturedDraft = vi.fn(async () => undefined);
        const completion = createCreatedNewSessionCompletion({ followUp, present, clearCapturedDraft });

        await expect(completion.complete()).rejects.toMatchObject({ stage: 'follow_up' });
        expect(present).not.toHaveBeenCalled();
        expect(clearCapturedDraft).not.toHaveBeenCalled();

        await expect(completion.complete()).resolves.toBe('opened');
        expect(followUp).toHaveBeenCalledTimes(2);
        expect(present).toHaveBeenCalledTimes(1);
        expect(clearCapturedDraft).toHaveBeenCalledTimes(1);
    });

    it('does not repeat accepted prompt follow-up when destination presentation retries', async () => {
        const followUp = vi.fn(async () => undefined);
        const present = vi.fn()
            .mockResolvedValueOnce('unavailable' as const)
            .mockResolvedValueOnce('opened' as const);
        const clearCapturedDraft = vi.fn(async () => undefined);
        const completion = createCreatedNewSessionCompletion({ followUp, present, clearCapturedDraft });

        await expect(completion.complete()).rejects.toMatchObject({ stage: 'presentation' });
        await expect(completion.complete()).resolves.toBe('opened');
        expect(followUp).toHaveBeenCalledTimes(1);
        expect(present).toHaveBeenCalledTimes(2);
        expect(clearCapturedDraft).toHaveBeenCalledTimes(1);
    });
});
