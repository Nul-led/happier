import { defineSettingsPage, settingsHosts } from '@/components/settings/catalog/settingDeclarations';

/**
 * The searchable rows of the Settings home. Its quick settings are shortcuts whose declarations
 * stay with their pages (Appearance, Notifications), so search opens the owning page.
 */
export const OVERVIEW_SETTINGS = defineSettingsPage({
    pageId: 'settings',
    sections: {
        about: {
            titleKey: 'settings.about',
            settings: {
                // What's new (build policy), Rate us (store review available) and Support us
                // (developer mode) are page state: search offers them and the About section answers.
                whatsNew: { titleKey: 'settings.whatsNew', descriptionKey: 'settings.whatsNewSubtitle' },
                rateUs: { titleKey: 'settings.rateUs', descriptionKey: 'settings.rateUsSubtitle' },
                supportUs: { titleKey: 'settings.supportUs' },
                github: { titleKey: 'settings.github' },
                privacyPolicy: { titleKey: 'settings.privacyPolicy' },
                termsOfService: { titleKey: 'settings.termsOfService' },
                eula: { titleKey: 'settings.eula', host: settingsHosts.ios },
                version: { titleKey: 'common.version' },
            },
        },
    },
});
