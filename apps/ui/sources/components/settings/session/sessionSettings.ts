import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/**
 * The Sessions page's searchable settings. Rows render their labels from these declarations. A row
 * whose subtitle describes its current value declares no description; its choices are keywords.
 */
export const SESSION_SETTINGS = defineSettingsPage({
    pageId: 'session',
    sections: {
        launchDefaults: {
            titleKey: 'settingsSession.rootGroups.launchDefaults.title',
            settings: {
                startWith: {
                    titleKey: 'settingsSession.sessionCreation.startWithTitle',
                    descriptionKey: 'settingsSession.sessionCreation.startWithDescription',
                    keywordKeys: [
                        'settingsSession.sessionCreation.startWithComposer',
                        'settingsSession.sessionCreation.startWithWizard',
                    ],
                },
                wizardDisposition: {
                    titleKey: 'settingsSession.sessionCreation.wizardDispositionTitle',
                    descriptionKey: 'settingsSession.sessionCreation.wizardDispositionSubtitle',
                },
                rememberProjectSelections: { titleKey: 'settingsSession.sessionCreation.rememberLastProjectSelectionsTitle' },
                rememberEngineSelections: { titleKey: 'settingsSession.sessionCreation.rememberLastEngineSelectionsTitle' },
            },
        },
        listOrganization: {
            titleKey: 'settingsSession.rootGroups.listOrganization.title',
            settings: {
                listDensity: {
                    titleKey: 'settingsAppearance.sessionListDensity.title',
                    descriptionKey: 'settingsAppearance.sessionListDensity.subtitle',
                },
                ordering: {
                    titleKey: 'settingsSession.sessionList.orderingTitle',
                    descriptionKey: 'settingsSession.sessionList.orderingSubtitle',
                },
                folderView: { titleKey: 'settingsSession.sessionList.folderTreeView' },
                folderSort: {
                    titleKey: 'settingsSession.sessionList.folderSortModeTitle',
                    descriptionKey: 'settingsSession.sessionList.folderSortModeSubtitle',
                },
                layout: {
                    titleKey: 'settingsSession.sessionList.layoutTitle',
                    descriptionKey: 'settingsSession.sessionList.layoutSubtitle',
                },
                activeGrouping: {
                    titleKey: 'settingsFeatures.sessionListActiveGrouping',
                    descriptionKey: 'settingsFeatures.sessionListActiveGroupingSubtitle',
                },
                inactiveGrouping: {
                    titleKey: 'settingsFeatures.sessionListInactiveGrouping',
                    descriptionKey: 'settingsFeatures.sessionListInactiveGroupingSubtitle',
                },
                hideInactive: {
                    titleKey: 'settingsFeatures.hideInactiveSessions',
                    descriptionKey: 'settingsFeatures.hideInactiveSessionsSubtitle',
                },
                rightPaneDefaultOpen: {
                    titleKey: 'settingsAppearance.sessionsRightPaneDefaultOpen',
                    descriptionKey: 'settingsAppearance.sessionsRightPaneDefaultOpenDescription',
                },
            },
        },
        rowDetails: {
            titleKey: 'settingsSession.rootGroups.rowDetails.title',
            settings: {
                tags: { titleKey: 'settingsSession.sessionList.tagsTitle' },
                identityDisplay: {
                    titleKey: 'settingsSession.sessionList.identityDisplayTitle',
                    descriptionKey: 'settingsSession.sessionList.identityDisplaySubtitle',
                },
                headerIdentityDisplay: {
                    titleKey: 'settingsSession.sessionList.headerIdentityDisplayTitle',
                    descriptionKey: 'settingsSession.sessionList.headerIdentityDisplaySubtitle',
                },
                activeColor: {
                    titleKey: 'settingsSession.sessionList.activeColorTitle',
                    descriptionKey: 'settingsSession.sessionList.activeColorSubtitle',
                },
                workspacePathDisplay: { titleKey: 'settingsSession.sessionList.workspacePathDisplayTitle' },
                workspaceFavicons: { titleKey: 'settingsSession.sessionList.workspaceFaviconsTitle' },
                workspaceMachineSubtitles: { titleKey: 'settingsSession.sessionList.workspaceMachineSubtitlesTitle' },
            },
        },
        activitySignals: {
            titleKey: 'settingsSession.rootGroups.activitySignals.title',
            settings: {
                workingStatusAnimatedText: { titleKey: 'settingsSession.sessionList.workingStatusAnimatedTextTitle' },
                attentionPromotion: {
                    titleKey: 'settingsSession.sessionList.attentionPromotionModeTitle',
                    descriptionKey: 'settingsSession.sessionList.attentionPromotionModeSubtitle',
                },
                attentionStandingDefault: { titleKey: 'settingsSession.sessionList.attentionStandingDefaultTitle' },
                workingPlacement: {
                    titleKey: 'settingsSession.sessionList.workingPlacementModeTitle',
                    descriptionKey: 'settingsSession.sessionList.workingPlacementModeSubtitle',
                },
                workingIndicator: { titleKey: 'settingsSession.sessionList.workingIndicatorTitle' },
            },
        },
        mobileLayout: {
            titleKey: 'settingsSession.rootGroups.mobileLayout.title',
            settings: {
                mobileWorkspaceExperience: { titleKey: 'settingsSession.mobileWorkspaceExperience.title' },
            },
        },
        agentPersonalization: {
            titleKey: 'settingsSession.rootGroups.agentPersonalization.title',
            settings: {
                renameSessions: { titleKey: 'settingsSession.promptPersonalization.askAgentToRenameSessionsTitle' },
                suggestReplyOptions: { titleKey: 'settingsSession.promptPersonalization.askAgentToSuggestReplyOptionsTitle' },
            },
        },
        detailedBehavior: {
            titleKey: 'settingsSession.detailedBehavior.title',
            settings: {
                composer: { titleKey: 'settingsSession.composer.title', descriptionKey: 'settingsSession.composer.entrySubtitle' },
                providerLimits: { titleKey: 'settingsSession.providerLimits.title', descriptionKey: 'settingsSession.providerLimits.entrySubtitle' },
                resume: { titleKey: 'settingsSession.resume.title', descriptionKey: 'settingsSession.resume.entrySubtitle' },
                runtime: { titleKey: 'settingsSession.runtime.title', descriptionKey: 'settingsSession.runtime.entrySubtitle' },
            },
        },
    },
});
