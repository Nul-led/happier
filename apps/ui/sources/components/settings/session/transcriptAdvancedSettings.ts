import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of Transcript › Performance and timing (a sub-page linked from Transcript). */
export const TRANSCRIPT_ADVANCED_SETTINGS = defineSettingsPage({
    pageId: 'transcript',
    subpage: { id: 'advanced', route: SETTINGS_ROUTES.transcriptAdvanced, titleKey: 'settingsSessionPages.transcript.advancedTitle' },
    sections: {
        performance: {
            titleKey: 'settingsSession.transcript.advanced.performanceTitle',
            settings: {
                coalesceEnabled: { storage: { scope: 'account', key: 'transcriptStreamingCoalesceEnabled', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.coalesceEnabledTitle', descriptionKey: 'settingsSession.transcript.advanced.coalesceEnabledSubtitle' },
                coalesceWindow: { storage: { scope: 'account', key: 'transcriptStreamingCoalesceWindowMs', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.coalesceWindowPromptTitle', descriptionKey: 'settingsSession.transcript.advanced.coalesceWindowPromptBody' },
                coalesceMaxBatch: { storage: { scope: 'account', key: 'transcriptStreamingCoalesceMaxBatchSize', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.coalesceMaxBatchPromptTitle', descriptionKey: 'settingsSession.transcript.advanced.coalesceMaxBatchPromptBody' },
                streamingPartialOutput: { storage: { scope: 'account', key: 'transcriptStreamingPartialOutputEnabled', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.streamingPartialOutputTitle', descriptionKey: 'settingsSession.transcript.advanced.streamingPartialOutputSubtitle' },
                thinkingPulseStale: { storage: { scope: 'account', key: 'transcriptThinkingPulseStaleMs', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.thinkingPulseStalePromptTitle', descriptionKey: 'settingsSession.transcript.advanced.thinkingPulseStalePromptBody' },
            },
        },
        motion: {
            titleKey: 'settingsSession.transcript.motionTitle',
            settings: {
                freshness: { storage: { scope: 'account', key: 'transcriptMotionFreshnessMs', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.freshnessPromptTitle', descriptionKey: 'settingsSession.transcript.advanced.freshnessPromptBody' },
                animateNewItems: { storage: { scope: 'account', key: 'transcriptAnimateNewItemsEnabled', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.animateNewItemsTitle', descriptionKey: 'settingsSession.transcript.advanced.animateNewItemsSubtitle' },
                animateToolExpandCollapse: { storage: { scope: 'account', key: 'transcriptAnimateToolExpandCollapseEnabled', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.animateToolExpandCollapseTitle', descriptionKey: 'settingsSession.transcript.advanced.animateToolExpandCollapseSubtitle' },
                animateToolExpandCollapseFreshOnly: { storage: { scope: 'account', key: 'transcriptAnimateToolExpandCollapseFreshOnly', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.animateToolExpandCollapseFreshOnlyTitle', descriptionKey: 'settingsSession.transcript.advanced.animateToolExpandCollapseFreshOnlySubtitle' },
                animateThinking: { storage: { scope: 'account', key: 'transcriptAnimateThinkingEnabled', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.animateThinkingTitle', descriptionKey: 'settingsSession.transcript.advanced.animateThinkingSubtitle' },
            },
        },
        scroll: {
            titleKey: 'settingsSession.transcript.scrollTitle',
            settings: {
                pinOffset: { storage: { scope: 'account', key: 'transcriptScrollPinOffsetThresholdPx', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.pinOffsetPromptTitle', descriptionKey: 'settingsSession.transcript.advanced.pinOffsetPromptBody' },
                autoFollow: { storage: { scope: 'account', key: 'transcriptScrollAutoFollowWhenPinned', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.autoFollowTitle', descriptionKey: 'settingsSession.transcript.advanced.autoFollowSubtitle' },
                jumpMinNewCount: { storage: { scope: 'account', key: 'transcriptScrollJumpToBottomMinNewCount', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.jumpMinNewCountPromptTitle', descriptionKey: 'settingsSession.transcript.advanced.jumpMinNewCountPromptBody' },
                jumpAnimateScroll: { storage: { scope: 'account', key: 'transcriptScrollJumpToBottomAnimateScroll', access: 'read_write' }, titleKey: 'settingsSession.transcript.advanced.jumpAnimateScrollTitle', descriptionKey: 'settingsSession.transcript.advanced.jumpAnimateScrollSubtitle' },
            },
        },
    },
});
