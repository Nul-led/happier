import { describe, expect, it, vi } from 'vitest';

// `t` is a genuine module boundary owned by the testkit. Mocking it here keeps
// these assertions about which message a failure maps to, rather than about the
// wording of one locale, which is not this owner's contract.
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

import { teamMutationFailureLabel } from './teamMutationPresentation';

describe('teamMutationFailureLabel', () => {
    it('does not claim nothing changed when an Action outcome is unknown', () => {
        expect(teamMutationFailureLabel({ kind: 'outcome_unknown', retryable: true, code: null }))
            .toBe('teams.errors.outcomeUnknown');
    });

    it('reports an operation this Home does not have as an update, not a domain failure', () => {
        // Relabelling a missing operation as, say, a mail-delivery problem sends
        // a manager to fix the wrong thing. It is a fact about the Home's age.
        expect(teamMutationFailureLabel({ kind: 'unsupported', retryable: false, code: null }))
            .toBe('teams.unavailable.updateRequired');
    });

    it('keeps pre-dispatch reachability and authoritative refusals distinct', () => {
        expect(teamMutationFailureLabel({ kind: 'unreachable', retryable: true, code: null }))
            .toBe('teams.errors.offline');
        expect(teamMutationFailureLabel({ kind: 'forbidden', retryable: false, code: null }))
            .toBe('teams.errors.forbidden');
        expect(teamMutationFailureLabel({ kind: 'conflict', retryable: false, code: null }))
            .toBe('teams.errors.conflict');
    });
});
