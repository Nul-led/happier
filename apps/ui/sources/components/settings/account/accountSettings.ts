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
        connections: {
            titleKey: 'settingsConnections.sectionTitle',
            settings: {
                directConnections: {
                    titleKey: 'settingsConnections.directTitle',
                    descriptionKey: 'settingsConnections.directOnDescription',
                    keywordKeys: ['settingsConnections.machineOptionRelay'],
                },
            },
        },
        privacy: {
            titleKey: 'settingsAccount.privacy',
            settings: {
                analytics: { storage: { scope: 'account', key: 'analyticsOptOut', access: 'read_write', invertBoolean: true }, titleKey: 'settingsAccount.shareUsageData', descriptionKey: 'settingsAccount.shareUsageDataDescription', keywordKeys: ['settingsAccount.analytics'] },
                crashReports: { storage: { scope: 'account', key: 'crashReportsOptOut', access: 'read_write', invertBoolean: true }, titleKey: 'settingsAccount.shareCrashReports', keywordKeys: ['settingsAccount.crashReports'] },
                settingsHistory: { titleKey: 'settingsAccount.history.title', descriptionKey: 'settingsAccount.history.footer' },
            },
        },
    },
});
