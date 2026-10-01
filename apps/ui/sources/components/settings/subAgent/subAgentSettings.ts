import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `subAgent` page. Rows render their labels from these declarations. */
export const SUB_AGENT_SETTINGS = defineSettingsPage({
    pageId: 'subAgent',
    sections: {
        instructions: {
            titleKey: 'subAgentGuidance.settings.instructionsTitle',
            settings: {
                notifyParentOnCompletion: { storage: { scope: 'account', key: 'executionRunsNotifyParentOnCompletionDefault', access: 'read_write' }, titleKey: 'subAgentGuidance.settings.notifyParentOnCompletion.title', descriptionKey: 'subAgentGuidance.settings.notifyParentOnCompletion.subtitle' },
            },
        },
        disabled: {
            titleKey: 'subAgentGuidance.settings.disabled.title',
            settings: {
                enableExecutionRuns: { titleKey: 'subAgentGuidance.settings.disabled.enableExecutionRuns.title' },
            },
        },
        related: {
            titleKey: 'subAgentGuidance.settings.related.groupTitle',
            settings: {
                session: { titleKey: 'subAgentGuidance.settings.related.sessionTitle', descriptionKey: 'subAgentGuidance.settings.related.sessionSubtitle' },
                agents: { titleKey: 'subAgentGuidance.settings.related.agentsTitle', descriptionKey: 'subAgentGuidance.settings.related.agentsSubtitle' },
            },
        },
    },
});
