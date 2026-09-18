import { describe, expect, it } from 'vitest';
import { classifyHttpMutationRequestFailure } from './mutationRequestOutcome';

describe('classifyHttpMutationRequestFailure', () => {
    it('keeps setup, DNS, and refused-connection failures definite when no Home could accept the mutation', () => {
        expect(classifyHttpMutationRequestFailure({ error: new Error('authority unavailable'), issued: false }))
            .toBe('not_dispatched');
        for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']) {
            expect(classifyHttpMutationRequestFailure({
                error: Object.assign(new TypeError('transport refused'), { code }),
                issued: true,
            })).toBe('not_dispatched');
        }
    });

    it('distinguishes cancellation before issue from cancellation after an issued mutation', () => {
        const before = new AbortController();
        before.abort();
        expect(classifyHttpMutationRequestFailure({
            error: new DOMException('cancelled', 'AbortError'),
            issued: false,
            signal: before.signal,
        })).toBe('cancelled');

        const after = new AbortController();
        after.abort();
        expect(classifyHttpMutationRequestFailure({
            error: new DOMException('cancelled', 'AbortError'),
            issued: true,
            signal: after.signal,
        })).toBe('outcome_unknown');
    });

    it('keeps a request-written response loss ambiguous, including nested transport causes', () => {
        expect(classifyHttpMutationRequestFailure({
            error: Object.assign(new TypeError('acknowledgement lost'), { code: 'ECONNRESET' }),
            issued: true,
        })).toBe('outcome_unknown');
        expect(classifyHttpMutationRequestFailure({
            error: { cause: Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }) },
            issued: true,
        })).toBe('not_dispatched');
    });
});
