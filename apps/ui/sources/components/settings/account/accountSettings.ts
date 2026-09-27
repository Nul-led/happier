import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** Account's searchable settings. Rows render their labels from these declarations. */
export const ACCOUNT_SETTINGS = defineSettingsPage({
    pageId: 'account',
    sections: {
        signIn: {
            titleKey: 'settingsAccount.security',
            settings: {
                emailPassword: {
                    titleKey: 'settingsAccount.nativePassword.securitySectionTitle',
                    keywordKeys: ['settingsAccount.nativePassword.password', 'settingsAccount.nativePassword.signInEmail'],
                },
            },
        },
        accountService: {
            settings: {
                accountService: {
                    titleKey: 'settingsAccount.accountServiceChooserTitle',
                    descriptionKey: 'settingsAccount.accountServiceDescription',
                    keywordKeys: [
                        'settingsAccount.accountServiceChangeService',
                        'settingsAccount.accountServiceLinkedHomes',
                        'settingsAccount.accountHomeDiscoveryTitle',
                    ],
                },
            },
        },
        privacy: {
            titleKey: 'settingsAccount.privacy',
            settings: {
                analytics: { titleKey: 'settingsAccount.shareUsageData', descriptionKey: 'settingsAccount.shareUsageDataDescription', keywordKeys: ['settingsAccount.analytics'] },
                crashReports: { titleKey: 'settingsAccount.shareCrashReports', keywordKeys: ['settingsAccount.crashReports'] },
                settingsHistory: { titleKey: 'settingsAccount.history.title', descriptionKey: 'settingsAccount.history.footer' },
            },
        },
    },
});
