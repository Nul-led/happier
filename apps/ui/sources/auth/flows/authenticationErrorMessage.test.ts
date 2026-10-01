import { describe, expect, it } from 'vitest';

import { t } from '@/text';
import { HappyError } from '@/utils/errors/errors';

import { authenticationErrorMessage } from './authenticationErrorMessage';

describe('authenticationErrorMessage', () => {
    it('keeps ordinary hosted-Home signup guidance unchanged', () => {
        const error = new HappyError('closed', false, { kind: 'auth', code: 'signup-disabled', status: 403 });

        expect(authenticationErrorMessage(error, 'https://home.example.test'))
            .toBe(t('errors.signupDisabled'));
    });

    it('explains intentional closed signup for a Personal Home', () => {
        const error = new HappyError('closed', false, { kind: 'auth', code: 'signup-disabled', status: 403 });

        expect(authenticationErrorMessage(error, 'https://home.example.test', { isPersonalHome: true }))
            .toBe(t('personalHome.auth.signupClosed'));
    });
});
