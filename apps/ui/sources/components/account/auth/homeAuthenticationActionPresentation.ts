import type { HomeAuthenticationExecution } from '@/auth/capabilities/authMethodCapabilities';
import type { IconName } from '@/components/ui/icons/Icon';
import { t } from '@/text';

export type HomeAuthenticationActionPresentation = Readonly<{
    /** Stable per-execution suffix used for test IDs. */
    slug: string;
    title: string;
    iconName: IconName;
}>;

/**
 * The one presentation owner for a Home authentication action.
 *
 * Every entry surface — Welcome, the shared auth-entry host, invitation and
 * mail landings — renders the same label and icon for the same execution. A
 * built-in native method must never fall through to the OAuth provider label,
 * because the Home's method display name is server-authored English and the
 * generic wording hides which journey the card actually starts.
 */
export function describeHomeAuthenticationAction(input: Readonly<{
    execution: HomeAuthenticationExecution;
    /** Localized or Home-published label, used only by real external providers. */
    providerName: string;
}>): HomeAuthenticationActionPresentation {
    const execution = input.execution;
    if (execution.kind === 'generated_key') {
        return { slug: 'generated-key', title: t('welcome.welcomePrimaryButton'), iconName: 'arrow-right' };
    }
    if (execution.kind === 'key_entry') {
        return { slug: 'key-entry', title: t('welcome.continueWithKey'), iconName: 'key' };
    }
    if (execution.kind === 'mtls') {
        return { slug: 'mtls', title: t('welcome.signInWithCertificate'), iconName: 'shield-check' };
    }
    if (execution.kind === 'email_password') {
        return {
            slug: `email-password-${execution.action}`,
            title: execution.action === 'provision'
                ? t('settingsAccount.nativePassword.createAccount')
                : execution.action === 'connect'
                    ? t('settingsAccount.nativePassword.connectTitle')
                    : t('settingsAccount.nativePassword.title'),
            iconName: 'envelope',
        };
    }
    return {
        slug: `provider-${execution.providerId}`,
        title: t('welcome.signUpWithProvider', { provider: input.providerName }),
        iconName: 'sign-in',
    };
}
