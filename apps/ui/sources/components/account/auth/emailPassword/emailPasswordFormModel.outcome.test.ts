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

it('keeps an untyped preflight failure determinate', () => {
    const problem = describeEmailPasswordFailure(
        new TypeError('Network request failed'),
    );

    expect(problem).toEqual({ field: 'form', messageKey: 'settingsAccount.nativePassword.offline' });
});

it('keeps an untyped mutation refusal off the password field', () => {
    const problem = describeEmailPasswordFailure(
        new HappyError('nope', false, { kind: 'auth', code: 'something_unmapped', status: 400 }),
        { credentialField: 'currentPassword' },
    );

    // The Home refused for a reason this client cannot name: say the Home did not complete it,
    // not that the method is unavailable and not that the password was wrong.
    expect(problem).toEqual({ field: 'form', messageKey: 'settingsAccount.nativePassword.serverUnavailable' });
});

it('retains the existence-neutral sign-in failure for a login attempt that begins no effect', () => {
    expect(describeEmailPasswordFailure(new TypeError('Network request failed'))).toEqual({
        field: 'form',
        messageKey: 'settingsAccount.nativePassword.offline',
    });
    expect(describeEmailPasswordFailure(
        new HappyError('nope', false, { kind: 'auth', code: 'authentication_failed', status: 401 }),
    )).toEqual({ field: 'password', messageKey: 'settingsAccount.nativePassword.signInFailed' });
});
