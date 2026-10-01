import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/**
 * Sign-in & security's searchable settings. Rows render their labels from these declarations.
 * The encryption controls are not declared: they render only behind `encryption.accountOptOut`, and a
 * page-level declaration cannot follow that gate, so search would offer rows that are not there.
 */
export const ACCOUNT_SECURITY_SETTINGS = defineSettingsPage({
    pageId: 'accountSecurity',
    sections: {
        emailPassword: {
            titleKey: 'settingsAccount.nativePassword.securitySectionTitle',
            settings: {
                signInEmail: { titleKey: 'settingsAccount.nativePassword.signInEmail' },
                password: { titleKey: 'settingsAccount.nativePassword.password', sensitive: true },
            },
        },
        backup: {
            titleKey: 'settingsAccount.backup',
            settings: {
                recoveryKey: { titleKey: 'settingsAccount.secretKey', descriptionKey: 'settingsAccount.recoveryKeyRowDescription', sensitive: true },
            },
        },
        sessions: {
            titleKey: 'settingsAccount.sessionsSectionTitle',
            settings: {
                signOutEverywhere: { titleKey: 'settingsApiTokens.signOutEverywhere.title', descriptionKey: 'settingsApiTokens.signOutEverywhere.subtitle' },
            },
        },
    },
});
