import { describe, expect, it, vi } from 'vitest';

// `t` is a genuine module boundary owned by the testkit. Mocking it here keeps
// these assertions about which message a failure maps to, rather than about the
// wording of one locale, which is not this owner's contract.
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

import { HappyError } from '@/utils/errors/errors';

import { accountErasureFailureNotice, homeGovernanceFailureNotice } from './homeGovernanceLabels';

describe('accountErasureFailureNotice', () => {
    it('tells the last owner to transfer ownership instead of inviting a retry', () => {
        const home = accountErasureFailureNotice(new HappyError('home_owner_transfer_required', true, {
            status: 409, kind: 'server', code: 'home_owner_transfer_required',
        }));
        expect(home.title).toBe('homeGovernance.changeFailedTitle');
        expect(home.body).toBe('homeGovernance.errorOwnerTransferRequired');

        expect(accountErasureFailureNotice(new HappyError('team_owner_transfer_required', true, {
            status: 409, kind: 'server', code: 'team_owner_transfer_required',
        })).body).toBe('homeGovernance.errorTeamOwnerTransferRequired');
    });

    it('keeps the unconfirmed-deletion notice when the answer carries no typed verdict', () => {
        const unconfirmed = {
            title: 'settingsAccount.deleteAccountFailedTitle',
            body: 'settingsAccount.deleteAccountFailed',
        };
        expect(accountErasureFailureNotice(new TypeError('network down'))).toEqual(unconfirmed);
        expect(accountErasureFailureNotice(new HappyError('account_delete_failed', true, {
            status: 502, kind: 'server', code: 'account_delete_failed',
        }))).toEqual(unconfirmed);
    });
});

describe('homeGovernanceFailureNotice', () => {
    it('never introduces an unconfirmed mutation as one that did not happen', () => {
        const notice = homeGovernanceFailureNotice({
            kind: 'outcome_unknown',
            retryable: false,
            code: null,
        });

        // The Home received the request and its answer was lost. Both the title
        // and the body have to leave that open, because the administrator's next
        // press would be a second non-idempotent governance mutation.
        expect(notice.title).toBe('homeGovernance.errorOutcomeUnknownTitle');
        expect(notice.body).toBe('homeGovernance.errorOutcomeUnknown');
    });

    it('prefers the Home’s own typed reason over the transport verdict', () => {
        // A 409 carrying the last-owner rule is a conflict *and* a named reason.
        // The named reason is the actionable one, so it wins.
        expect(homeGovernanceFailureNotice({
            kind: 'conflict',
            retryable: false,
            code: 'home_owner_transfer_required',
        }).body).toBe('homeGovernance.errorOwnerTransferRequired');
    });

    it('explains an untyped conflict as a Home that moved, not as a change that failed', () => {
        expect(homeGovernanceFailureNotice({
            kind: 'conflict',
            retryable: false,
            code: null,
        }).body).toBe('homeGovernance.errorConflict');
    });
});
