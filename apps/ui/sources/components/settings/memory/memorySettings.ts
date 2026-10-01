import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `memory` page. Rows render their labels from these declarations. */
export const MEMORY_SETTINGS = defineSettingsPage({
    pageId: 'memory',
    sections: {
        localIndex: {
            titleKey: 'memorySearchSettings.enabled.sectionTitle',
            settings: {
                enabled: { titleKey: 'memorySearchSettings.enabled.title' },
            },
        },
        indexing: {
            titleKey: 'memorySearchSettings.indexing.title',
            settings: {
                indexMode: { titleKey: 'memorySearchSettings.indexMode.triggerTitle' },
                backfill: { titleKey: 'memorySearchSettings.backfill.triggerTitle' },
                coverage: { titleKey: 'memorySearchSettings.coverage.triggerTitle' },
                include: { titleKey: 'memorySearchSettings.archived.includeTitle' },
            },
        },
        contentPolicy: {
            titleKey: 'memorySearchSettings.contentPolicy.title',
            settings: {
                userMessages: {
                    titleKey: 'memorySearchSettings.contentPolicy.userMessagesTitle',
                    descriptionKey: 'memorySearchSettings.contentPolicy.userMessagesSubtitle',
                },
                assistantMessages: {
                    titleKey: 'memorySearchSettings.contentPolicy.assistantMessagesTitle',
                    descriptionKey: 'memorySearchSettings.contentPolicy.assistantMessagesSubtitle',
                },
                reasoning: {
                    titleKey: 'memorySearchSettings.contentPolicy.reasoningTitle',
                    descriptionKey: 'memorySearchSettings.contentPolicy.reasoningSubtitle',
                },
                toolSummaries: {
                    titleKey: 'memorySearchSettings.contentPolicy.toolSummariesTitle',
                    descriptionKey: 'memorySearchSettings.contentPolicy.toolSummariesSubtitle',
                },
            },
        },
        // Deep mode only; the custom rows also depend on the chosen provider. When a row is not shown,
        // search reveals this section (or the Index mode row that leads to it).
        embeddings: {
            titleKey: 'memorySearchSettings.embeddings.groupTitle',
            settings: {
                embeddingsMode: { titleKey: 'memorySearchSettings.embeddings.mode.title' },
                embeddingsProvider: { titleKey: 'memorySearchSettings.embeddings.provider.title' },
                localModel: { titleKey: 'memorySearchSettings.embeddings.modelTitle' },
                queryPrefix: { titleKey: 'memorySearchSettings.embeddings.queryPrefixTitle' },
                documentPrefix: { titleKey: 'memorySearchSettings.embeddings.documentPrefixTitle' },
                baseUrl: { titleKey: 'memorySearchSettings.embeddings.openAi.baseUrlTitle' },
                remoteModel: { titleKey: 'memorySearchSettings.embeddings.openAi.modelTitle' },
                apiKey: { titleKey: 'memorySearchSettings.embeddings.openAi.apiKeyTitle', sensitive: true },
                dimensions: { titleKey: 'memorySearchSettings.embeddings.openAi.dimensionsTitle' },
                textWeight: { titleKey: 'memorySearchSettings.embeddings.advanced.ftsWeightTitle' },
                embeddingWeight: { titleKey: 'memorySearchSettings.embeddings.advanced.embeddingWeightTitle' },
            },
        },
        hints: {
            titleKey: 'memorySearchSettings.hints.title',
            settings: {
                summarizerBackend: { titleKey: 'memorySearchSettings.hints.backend.title' },
                summarizerModel: { titleKey: 'memorySearchSettings.hints.model.title' },
                permissions: { titleKey: 'memorySearchSettings.hints.permissions.triggerTitle' },
            },
        },
        budgets: {
            titleKey: 'memorySearchSettings.budgets.groupTitle',
            settings: {
                lightBudget: { titleKey: 'memorySearchSettings.budgets.lightTitle' },
                deepBudget: { titleKey: 'memorySearchSettings.budgets.deepTitle' },
            },
        },
        privacy: {
            titleKey: 'memorySearchSettings.privacy.groupTitle',
            settings: {
                deleteOnDisable: {
                    titleKey: 'memorySearchSettings.privacy.deleteOnDisableTitle',
                    descriptionKey: 'memorySearchSettings.privacy.deleteOnDisableSubtitle',
                },
            },
        },
    },
});
