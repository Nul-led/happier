import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** API Tokens' searchable settings (plan 01 §6.1). Rows render their labels from these declarations. */
export const API_TOKEN_SETTINGS = defineSettingsPage({
    pageId: 'apiTokens',
    sections: {
        cliApprovals: {
            titleKey: 'settingsApiTokens.cliPolicy.sectionTitle',
            settings: {
                cliApprovals: { titleKey: 'settingsApiTokens.cliPolicy.title', descriptionKey: 'settingsApiTokens.cliPolicy.description' },
            },
        },
        security: {
            titleKey: 'settingsApiTokens.securityTitle',
            settings: {
                revokeAll: { titleKey: 'settingsApiTokens.revokeAll.title', descriptionKey: 'settingsApiTokens.revokeAll.subtitle' },
            },
        },
    },
});
