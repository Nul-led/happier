import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `transcript` page. Rows render their labels from these declarations. */
export const TRANSCRIPT_SETTINGS = defineSettingsPage({
    pageId: 'transcript',
    sections: {
        layout: {
            titleKey: 'settingsSession.transcript.layoutTitle',
            settings: {
                layoutPicker: {
                    titleKey: 'settingsSession.transcript.layoutPickerTitle',
                    keywordKeys: ['settingsSession.transcript.layout.linearTitle', 'settingsSession.transcript.layout.turnsTitle'],
                },
                messageTimestamps: { titleKey: 'settingsSession.transcript.messageTimestampsTitle' },
            },
        },
        thinking: {
            titleKey: 'settingsSession.thinking.title',
            settings: {
                displayMode: {
                    titleKey: 'settingsSession.thinking.displayModeTitle',
                    keywordKeys: ['settingsSessionPages.transcript.thinkingSummary', 'settingsSession.thinking.displayMode.toolTitle'],
                },
                inlineChrome: { titleKey: 'settingsSession.thinking.inlineChromeTitle', descriptionKey: 'settingsSession.thinking.inlineChromeSubtitle' },
            },
        },
        toolRendering: {
            titleKey: 'settingsSessionPages.transcript.toolsSection',
            settings: {
                timelineChrome: {
                    titleKey: 'settingsSession.toolRendering.timelineChrome.title',
                    keywordKeys: ['settingsSession.toolRendering.timelineChrome.cardsTitle', 'settingsSession.toolRendering.timelineChrome.activityFeedTitle'],
                },
                toolCallsGroup: { titleKey: 'settingsSession.transcript.toolCallsGroupTitle', descriptionKey: 'settingsSession.transcript.toolCallsGroupSubtitle' },
                toolCallsStrategy: { titleKey: 'settingsSession.transcript.advanced.toolCallsStrategyTitle' },
                toolCallsCollapsedPreviewCount: { titleKey: 'settingsSession.transcript.advanced.toolCallsCollapsedPreviewCountTitle' },
                toolCallsGroupBackground: { titleKey: 'settingsSession.transcript.toolCallsGroupBackgroundTitle', descriptionKey: 'settingsSession.transcript.toolCallsGroupBackgroundSubtitle' },
                defaultToolDetailLevel: { titleKey: 'settingsSession.toolRendering.defaultToolDetailLevelTitle' },
                expandedToolDetailLevel: { titleKey: 'settingsSession.toolRendering.expandedToolDetailLevelTitle' },
                cardTapAction: { titleKey: 'settingsSession.toolRendering.cardTapActionTitle' },
                defaultExpanded: { titleKey: 'settingsSession.toolRendering.activityFeed.defaultExpandedTitle', descriptionKey: 'settingsSession.toolRendering.activityFeed.defaultExpandedSubtitle' },
                showDebugByDefault: { titleKey: 'settingsSession.toolRendering.showDebugByDefaultTitle', descriptionKey: 'settingsSession.toolRendering.showDebugByDefaultSubtitle' },
                toolDetailOverrides: { titleKey: 'settingsSession.toolDetailOverrides.title', descriptionKey: 'settingsSessionPages.transcript.toolOverridesDescription' },
            },
        },
        group: {
            titleKey: 'settingsSession.transcript.messageActions.groupTitle',
            settings: {
                selectionEnabled: { titleKey: 'settingsSession.transcript.messageActions.selectionEnabled.title', descriptionKey: 'settingsSession.transcript.messageActions.selectionEnabled.subtitle' },
                sendToSessionEnabled: { titleKey: 'settingsSession.transcript.messageActions.sendToSessionEnabled.title', descriptionKey: 'settingsSession.transcript.messageActions.sendToSessionEnabled.subtitle' },
                sendToSessionTemplate: { titleKey: 'settingsSession.transcript.messageActions.template.title' },
                bulkCopyFormat: {
                    titleKey: 'settingsSession.transcript.messageActions.bulkCopyFormat.title',
                    keywordKeys: ['settingsSessionPages.transcript.copyMarkdown', 'settingsSession.transcript.messageActions.bulkCopyFormat.plain'],
                },
            },
        },
        motion: {
            titleKey: 'settingsSession.transcript.motionTitle',
            settings: {
                motionPicker: { titleKey: 'settingsSession.transcript.motionPickerTitle' },
            },
        },
        scroll: {
            titleKey: 'settingsSession.transcript.scrollTitle',
            settings: {
                scrollPin: { titleKey: 'settingsSession.transcript.scrollPinTitle', descriptionKey: 'settingsSession.transcript.scrollPinSubtitle' },
                jumpToBottom: { titleKey: 'settingsSession.transcript.jumpToBottomTitle', descriptionKey: 'settingsSession.transcript.jumpToBottomSubtitle' },
            },
        },
        advanced: {
            titleKey: 'settingsSession.advanced.title',
            settings: {
                advanced: { titleKey: 'settingsSessionPages.transcript.advancedTitle', descriptionKey: 'settingsSessionPages.transcript.advancedLinkDescription' },
            },
        },
    },
});
