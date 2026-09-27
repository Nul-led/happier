import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `notificationsPush` page. Rows render their labels from these declarations. */
export const NOTIFICATIONS_PUSH_SETTINGS = defineSettingsPage({
    pageId: 'notificationsPush',
    sections: {
        status: {
            titleKey: 'settingsNotifications.pushTroubleshooting.status.title',
            settings: {
                refresh: { titleKey: 'settingsNotifications.pushTroubleshooting.actions.refreshTitle', descriptionKey: 'settingsNotifications.pushTroubleshooting.actions.refreshSubtitle' },
            },
        },
    },
});
