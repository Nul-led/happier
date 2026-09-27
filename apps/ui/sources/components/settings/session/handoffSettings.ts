import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `handoff` page. Rows render their labels from these declarations. */
export const HANDOFF_SETTINGS = defineSettingsPage({
    pageId: 'handoff',
    sections: {
        workspace: {
            titleKey: 'settingsSessionPages.handoff.workspaceSection',
            settings: {
                workspaceMode: {
                    titleKey: 'settingsSession.handoff.workspaceMode.title',
                    keywordKeys: ['settingsSessionPages.handoff.keepUpdated', 'workspaceSync.mode.copyOnce'],
                },
                mode: {
                    titleKey: 'settingsSession.handoff.advanced.modeTitle',
                    keywordKeys: ['workspaceSync.mode.mirrorExactly', 'workspaceSync.mode.keepBothInSync'],
                },
                includeIgnoredMode: { titleKey: 'settingsSession.handoff.includeIgnoredMode.title' },
                // Rendered while ignored files are "Include selected".
                ignoredIncludeGlobs: { titleKey: 'settingsSession.handoff.includeIgnoredMode.globsTitle' },
            },
        },
        directSessions: {
            titleKey: 'settingsSession.handoff.directTargetMode.groupTitle',
            settings: {
                directTargetMode: { titleKey: 'settingsSession.handoff.directTargetMode.title' },
            },
        },
    },
});
