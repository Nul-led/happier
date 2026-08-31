import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ callbacks: [] as Array<() => void> }));
vi.mock('@/storage/inTx', () => ({
    afterTx: (_tx: unknown, callback: () => void) => harness.callbacks.push(callback),
}));

import {
    notifySessionTranscriptMutationAfterCommit,
    registerSessionTranscriptMutationObserver,
} from './sessionTranscriptMutationObserver';

describe('canonical transcript mutation observer', () => {
    it('delivers only after commit and never lets observer failure escape the canonical callback', async () => {
        const observer = vi.fn(() => { throw new Error('derived search failed'); });
        const unregister = registerSessionTranscriptMutationObserver(observer);
        notifySessionTranscriptMutationAfterCommit({} as never, {
            kind: 'upsert',
            message: { id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, content: { t: 'plain', v: { content: { type: 'text', text: 'hello' } } } },
        });
        expect(observer).not.toHaveBeenCalled();
        expect(() => harness.callbacks.splice(0).forEach((callback) => callback())).not.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(observer).toHaveBeenCalledTimes(1);
        unregister();
    });

    it('does not notify when the transaction owner discards its after-commit callbacks', async () => {
        const observer = vi.fn();
        const unregister = registerSessionTranscriptMutationObserver(observer);
        notifySessionTranscriptMutationAfterCommit({} as never, { kind: 'remove-session', sessionId: 's-1' });
        harness.callbacks.splice(0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(observer).not.toHaveBeenCalled();
        unregister();
    });
});
