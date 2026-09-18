import { expect, it } from 'vitest';

import { HappyError } from '@/utils/errors/errors';

import { describeEmailPasswordFailure } from './emailPasswordFormModel';

const UNCONFIRMED = 'settingsAccount.nativePassword.outcomeUnconfirmed';

it('maps the canonical Action outcome-unknown settlement to an unconfirmed outcome', () => {
    const problem = describeEmailPasswordFailure(
        new HappyError('unknown', false, { kind: 'auth', code: 'outcome_unknown' }),
    );

    expect(problem).toEqual({ field: 'form', messageKey: UNCONFIRMED });
});

it('never blames the credential when a dispatched mutation lost its verdict', () => {
    const problem = describeEmailPasswordFailure(
        new TypeError('Network request failed'),
        { effectMayHaveBegun: true },
    );

    expect(problem).toEqual({ field: 'form', messageKey: UNCONFIRMED });
});

it('keeps an untyped mutation refusal off the password field', () => {
    const problem = describeEmailPasswordFailure(
        new HappyError('nope', false, { kind: 'auth', code: 'something_unmapped', status: 400 }),
        { effectMayHaveBegun: true, credentialField: 'currentPassword' },
    );

    expect(problem).toEqual({ field: 'form', messageKey: UNCONFIRMED });
});

it('retains the existence-neutral sign-in failure for a login attempt that begins no effect', () => {
    expect(describeEmailPasswordFailure(new TypeError('Network request failed'))).toEqual({
        field: 'form',
        messageKey: 'settingsAccount.nativePassword.offline',
    });
    expect(describeEmailPasswordFailure(
        new HappyError('nope', false, { kind: 'auth', code: 'authentication_failed', status: 401 }),
        { effectMayHaveBegun: true },
    )).toEqual({ field: 'password', messageKey: 'settingsAccount.nativePassword.signInFailed' });
});
