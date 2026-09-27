import { defineSettingsPage, settingsHosts } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `sourceControl` page. Rows render their labels from these declarations. */
export const SOURCE_CONTROL_SETTINGS = defineSettingsPage({
    pageId: 'sourceControl',
    sections: {
        commits: {
            titleKey: 'settingsSourceControl.page.commits.title',
            settings: {
                commitStrategy: {
                    titleKey: 'settingsSourceControl.page.commitStrategy.title',
                    keywordKeys: ['settingsSourceControl.page.commitStrategy.atomic', 'settingsSourceControl.page.commitStrategy.gitStaging'],
                },
                commitMessageGenerator: { titleKey: 'settingsSourceControl.commitMessageGenerator.title', descriptionKey: 'settingsSourceControl.page.generator.description' },
                commitMessageAgent: { titleKey: 'settingsSourceControl.page.generator.agentTitle', descriptionKey: 'settingsSourceControl.page.generator.agentDescription' },
                commitMessageInstructions: { titleKey: 'settingsSourceControl.page.generator.instructionsTitle', descriptionKey: 'settingsSourceControl.page.generator.instructionsDescription' },
                includeCoAuthoredBy: { titleKey: 'settingsSourceControl.commitAttribution.includeCoAuthoredBy.title', descriptionKey: 'settingsSourceControl.page.coAuthoredByDescription' },
            },
        },
        remote: {
            titleKey: 'settingsSourceControl.page.remote.title',
            settings: {
                confirmBeforePulling: { titleKey: 'settingsSourceControl.remoteConfirmation.confirmBeforePulling.title', descriptionKey: 'settingsSourceControl.remoteConfirmation.confirmBeforePulling.subtitle' },
                confirmBeforePushing: { titleKey: 'settingsSourceControl.remoteConfirmation.confirmBeforePushing.title', descriptionKey: 'settingsSourceControl.remoteConfirmation.confirmBeforePushing.subtitle' },
                pushRejection: {
                    titleKey: 'settingsSourceControl.page.pushRejection.title',
                    keywordKeys: ['settingsSourceControl.page.pushRejection.fetch'],
                },
            },
        },
        routing: {
            titleKey: 'settingsSourceControl.page.routing.title',
            settings: {
                gitRouting: {
                    titleKey: 'settingsSourceControl.page.routing.rowTitle',
                    keywordKeys: ['settingsSourceControl.page.routing.git', 'settingsSourceControl.page.routing.sapling'],
                },
            },
        },
        files: {
            titleKey: 'settingsSourceControl.page.files.title',
            settings: {
                // The renderer and layout rows exist on web only (the view's `Platform.OS === 'web'`).
                diffRenderer: { titleKey: 'settingsSourceControl.page.files.renderer', host: settingsHosts.web },
                diffLayout: {
                    titleKey: 'settingsSourceControl.page.files.layout',
                    host: settingsHosts.web,
                    keywordKeys: ['settingsSourceControl.page.files.unified', 'settingsSourceControl.page.files.split'],
                },
                syntaxHighlighting: { titleKey: 'settingsSourceControl.page.files.highlighting' },
                changedFilesDensity: { titleKey: 'settingsSourceControl.page.files.density' },
                showLineNumbersInDiffs: { titleKey: 'settingsAppearance.showLineNumbersInDiffs', descriptionKey: 'settingsAppearance.showLineNumbersInDiffsDescription' },
                showLineNumbersInToolViews: { titleKey: 'settingsAppearance.showLineNumbersInToolViews', descriptionKey: 'settingsAppearance.showLineNumbersInToolViewsDescription' },
                wrapLinesInDiffs: { titleKey: 'settingsAppearance.wrapLinesInDiffs', descriptionKey: 'settingsAppearance.wrapLinesInDiffsDescription' },
            },
        },
        backends: {
            // One row per source-control backend the chosen machine offers (page state).
            settings: {
                backendDefaultDiff: {
                    titleKey: 'settingsSourceControl.page.backend.defaultDiff',
                    descriptionKey: 'settingsSourceControl.backends.defaultDiffItemSubtitle',
                },
            },
        },
        editor: {
            titleKey: 'settingsSourceControl.editor',
            settings: {
                editorAutoSave: { titleKey: 'settingsSourceControl.editorAutoSave', descriptionKey: 'settingsSourceControl.editorAutoSaveDescription' },
            },
        },
        // The same Editor section on the page; this row renders only with the rich Markdown editor.
        editorMarkdown: {
            titleKey: 'settingsSourceControl.editor',
            featureId: 'files.markdownRichEditor',
            settings: {
                markdownEditMode: {
                    titleKey: 'settingsSourceControl.page.editor.markdownTitle',
                    keywordKeys: ['settingsSourceControl.page.editor.rich', 'settingsSourceControl.page.editor.raw'],
                },
            },
        },
    },
});
