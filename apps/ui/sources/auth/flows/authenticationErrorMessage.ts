import { t } from '@/text';
import {
    HOME_ADDRESS_MISMATCH_AUTH_CODE,
    HOME_IDENTITY_MISMATCH_AUTH_CODE,
} from './authenticationFailure';
import { HappyError } from '@/utils/errors/errors';

/** Present proof failures using the Home captured by the authentication flow. */
export function authenticationErrorMessage(
    error: unknown,
    home?: string,
    context: Readonly<{ isPersonalHome?: boolean }> = {},
): string | null {
    if (!(error instanceof HappyError) || error.kind !== 'auth') return null;
    if (error.code === 'account-disabled' && error.status === 403 && home) {
        return t('errors.accountDisabled', { home });
    }
    if (error.code === HOME_IDENTITY_MISMATCH_AUTH_CODE && home) {
        return t('errors.homeIdentityMismatch', { home });
    }
    if (error.code === HOME_ADDRESS_MISMATCH_AUTH_CODE && home) {
        return t('errors.homeAddressNotConfirmed', { home });
    }
    if (error.code === 'signup-disabled') {
        return context.isPersonalHome === true
            ? t('personalHome.auth.signupClosed')
            : t('errors.signupDisabled');
    }
    return error.status === 403 ? t('errors.permissionDenied') : t('errors.authenticationFailed');
}
