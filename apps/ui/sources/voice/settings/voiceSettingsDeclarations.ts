import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/**
 * The searchable settings of the Voice intent pages. Rows render their labels from these
 * declarations; only rows every provider shows are declared (provider-specific rows come and go
 * with the selected provider, so search could not land on them).
 */
export const VOICE_DICTATION_SETTINGS = defineSettingsPage({
    pageId: 'voiceDictation',
    sections: {
        dictation: {
            titleKey: 'settingsVoice.dictation.title',
            settings: {
                provider: { titleKey: 'settingsVoice.dictation.provider', descriptionKey: 'settingsVoice.dictation.providerSubtitle' },
                language: { titleKey: 'settingsVoice.dictation.language', descriptionKey: 'settingsVoice.dictation.languageSubtitle' },
            },
        },
    },
});

export const VOICE_CONVERSATIONS_SETTINGS = defineSettingsPage({
    pageId: 'voiceConversations',
    sections: {
        provider: {
            titleKey: 'settingsVoice.providerSectionTitle',
            settings: {
                provider: { titleKey: 'settingsVoice.providerSectionTitle', descriptionKey: 'settingsVoice.providerSectionDescription' },
            },
        },
        language: {
            titleKey: 'settingsVoice.languageTitle',
            settings: {
                assistantLanguage: { titleKey: 'settingsVoice.preferredLanguage', descriptionKey: 'settingsVoice.preferredLanguageSubtitle' },
            },
        },
    },
});

export const VOICE_PRIVACY_SETTINGS = defineSettingsPage({
    pageId: 'voicePrivacy',
    sections: {
        contextSharing: {
            titleKey: 'settingsVoice.privacy.title',
            settings: {
                currentUiContextMode: { titleKey: 'settingsVoice.privacy.currentUiContextModeTitle', descriptionKey: 'settingsVoice.privacy.currentUiContextModeSubtitle' },
                shareSessionSummary: { titleKey: 'settingsVoice.privacy.shareSessionSummary', descriptionKey: 'settingsVoice.privacy.shareSessionSummarySubtitle' },
                shareRecentMessages: { titleKey: 'settingsVoice.privacy.shareRecentMessages', descriptionKey: 'settingsVoice.privacy.shareRecentMessagesSubtitle' },
                shareToolNames: { titleKey: 'settingsVoice.privacy.shareToolNames', descriptionKey: 'settingsVoice.privacy.shareToolNamesSubtitle' },
                shareDeviceInventory: { titleKey: 'settingsVoice.privacy.shareDeviceInventory', descriptionKey: 'settingsVoice.privacy.shareDeviceInventorySubtitle' },
                sharePermissionRequests: { titleKey: 'settingsVoice.privacy.sharePermissionRequests', descriptionKey: 'settingsVoice.privacy.sharePermissionRequestsSubtitle' },
            },
        },
        history: {
            titleKey: 'settingsVoice.history.sectionTitle',
            settings: {
                voiceHistory: { titleKey: 'settingsVoice.history.entryTitle', descriptionKey: 'settingsVoice.history.entrySubtitle' },
            },
        },
    },
});

export const VOICE_ADVANCED_SETTINGS = defineSettingsPage({
    pageId: 'voiceAdvanced',
    sections: {
        surface: {
            titleKey: 'settingsVoice.ui.title',
            settings: {
                activityFeedEnabled: { titleKey: 'settingsVoice.ui.activityFeedEnabled', descriptionKey: 'settingsVoice.ui.activityFeedEnabledSubtitle' },
                activityFeedAutoExpandOnStart: { titleKey: 'settingsVoice.ui.activityFeedAutoExpandOnStart', descriptionKey: 'settingsVoice.ui.activityFeedAutoExpandOnStartSubtitle' },
                orbEnabled: { titleKey: 'settingsVoice.ui.orbEnabled', descriptionKey: 'settingsVoice.ui.orbEnabledSubtitle' },
                scopeDefault: { titleKey: 'settingsVoice.ui.scopeTitle', descriptionKey: 'settingsVoice.ui.scopeSubtitle' },
                surfaceLocation: { titleKey: 'settingsVoice.ui.surfaceLocationTitle', descriptionKey: 'settingsVoice.ui.surfaceLocationSubtitle' },
            },
        },
        updates: {
            titleKey: 'settingsVoice.ui.updates.title',
            settings: {
                activeSession: { titleKey: 'settingsVoice.ui.updates.activeSessionTitle', descriptionKey: 'settingsVoice.ui.updates.activeSessionSubtitle' },
                otherSessions: { titleKey: 'settingsVoice.ui.updates.otherSessionsTitle', descriptionKey: 'settingsVoice.ui.updates.otherSessionsSubtitle' },
                snippetsMaxMessages: { titleKey: 'settingsVoice.ui.updates.snippetsMaxMessagesTitle', descriptionKey: 'settingsVoice.ui.updates.snippetsMaxMessagesSubtitle' },
                includeUserMessagesInSnippets: { titleKey: 'settingsVoice.ui.updates.includeUserMessagesInSnippetsTitle', descriptionKey: 'settingsVoice.ui.updates.includeUserMessagesInSnippetsSubtitle' },
                otherSessionsSnippetsMode: { titleKey: 'settingsVoice.ui.updates.otherSessionsSnippetsModeTitle' },
            },
        },
    },
});
