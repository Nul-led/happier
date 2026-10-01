import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `permissions` page. Rows render their labels from these declarations. */
export const PERMISSIONS_SETTINGS = defineSettingsPage({
    pageId: 'permissions',
    sections: {
        defaults: {
            titleKey: 'settingsSession.defaultPermissions.title',
            settings: {
                /** One row per enabled agent; the anchor marks the whole section. */
                defaultPermissions: {
                    titleKey: 'settingsSession.defaultPermissions.title',
                    keywordKeys: ['settingsSession.permissions.defaultPermissionModeTitle'],
                },
            },
        },
        duringSession: {
            titleKey: 'settingsSessionPages.permissions.duringSessionSection',
            settings: {
                promptSurface: { storage: { scope: 'account', key: 'permissionPromptSurface', access: 'read_write' },
                    titleKey: 'settingsSession.permissions.promptSurfaceTitle',
                    keywordKeys: ['settingsSessionPages.permissions.promptSurfaceComposer', 'settingsSession.permissions.promptSurface.transcriptTitle'],
                },
                applyPermissionChanges: { storage: { scope: 'account', key: 'sessionPermissionModeApplyTiming', access: 'read_write' },
                    titleKey: 'settingsSession.defaultPermissions.applyPermissionChangesTitle',
                    keywordKeys: ['settingsSessionPages.permissions.applyImmediately', 'settingsSessionPages.permissions.applyNextMessage'],
                },
            },
        },
        defaultStorage: {
            titleKey: 'settingsSession.defaultStorage.title',
            featureId: 'sessions.direct',
            settings: {
                global: { storage: { scope: 'account', key: 'newSessionDefaultPersistenceModeV1', access: 'read_write' },
                    titleKey: 'settingsSession.defaultStorage.globalTitle',
                    keywordKeys: ['sessionsList.storagePersistedTab', 'sessionsList.storageDirectTab'],
                },
            },
        },
    },
});
