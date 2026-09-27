import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/**
 * The searchable settings on an action's own page. Only the Create session action carries static
 * settings of its own (the spawn policy); every other action page lists its surfaces, which come from
 * the action catalog.
 */
export const ACTIONS_CREATE_SESSION_SETTINGS = defineSettingsPage({
    pageId: 'actions',
    subpage: { id: 'createSession', route: '/settings/actions/session.spawn_new', titleKey: 'settingsActions.spawnPolicy.title' },
    sections: {
        spawnPolicy: {
            titleKey: 'settingsActions.spawnPolicy.title',
            settings: {
                allowCustomDirectory: { titleKey: 'settingsActions.spawnPolicy.toggles.allowCustomDirectory.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowCustomDirectory.subtitle' },
                allowCrossMachine: { titleKey: 'settingsActions.spawnPolicy.toggles.allowCrossMachine.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowCrossMachine.subtitle' },
                allowBackendTargetOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowBackendTargetOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowBackendTargetOverride.subtitle' },
                allowModelOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowModelOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowModelOverride.subtitle' },
                allowPermissionModeOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowPermissionModeOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowPermissionModeOverride.subtitle' },
                allowAgentModeOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowAgentModeOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowAgentModeOverride.subtitle' },
                allowConfigOptionOverrides: { titleKey: 'settingsActions.spawnPolicy.toggles.allowConfigOptionOverrides.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowConfigOptionOverrides.subtitle' },
                allowProfileOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowProfileOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowProfileOverride.subtitle' },
                allowConnectedServicesOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowConnectedServicesOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowConnectedServicesOverride.subtitle' },
                allowMcpSelectionOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowMcpSelectionOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowMcpSelectionOverride.subtitle' },
                allowTranscriptStorageOverride: { titleKey: 'settingsActions.spawnPolicy.toggles.allowTranscriptStorageOverride.title', descriptionKey: 'settingsActions.spawnPolicy.toggles.allowTranscriptStorageOverride.subtitle' },
                permissionCeiling: { titleKey: 'settingsActions.spawnPolicy.permissionCeiling.title', descriptionKey: 'settingsActions.spawnPolicy.permissionCeiling.subtitle' },
            },
        },
    },
});
