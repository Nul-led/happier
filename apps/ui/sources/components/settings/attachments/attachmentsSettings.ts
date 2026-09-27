import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `attachments` page. Rows render their labels from these declarations. */
export const ATTACHMENTS_SETTINGS = defineSettingsPage({
    pageId: 'attachments',
    sections: {
        uploadLocation: {
            titleKey: 'settingsAttachments.uploadLocation.title',
            settings: {
                uploadLocation: { titleKey: 'settingsAttachments.uploadLocation.rowTitle', keywordKeys: ['settingsAttachments.uploadLocation.options.osTemp.title'] },
                uploadsDirectory: { titleKey: 'settingsAttachments.workspaceDirectory.uploadsDirectory.title' },
            },
        },
        sourceControlIgnore: {
            titleKey: 'settingsAttachments.sourceControlIgnore.title',
            settings: {
                ignoreStrategy: { titleKey: 'settingsAttachments.sourceControlIgnore.rowTitle', keywordKeys: ['settingsAttachments.sourceControlIgnore.options.gitignore.title'] },
                writeIgnoreRules: { titleKey: 'settingsAttachments.sourceControlIgnore.writeIgnoreRules.title', descriptionKey: 'settingsAttachments.sourceControlIgnore.writeIgnoreRules.subtitle' },
            },
        },
        limits: {
            titleKey: 'settingsAttachments.limits.title',
            settings: {
                maxAttachmentSize: { titleKey: 'settingsAttachments.limits.maxAttachmentSize.title' },
            },
        },
    },
});
