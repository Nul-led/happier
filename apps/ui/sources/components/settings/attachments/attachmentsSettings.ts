import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `attachments` page. Rows render their labels from these declarations. */
export const ATTACHMENTS_SETTINGS = defineSettingsPage({
    pageId: 'attachments',
    sections: {
        uploadLocation: {
            titleKey: 'settingsAttachments.uploadLocation.title',
            settings: {
                uploadLocation: { storage: { scope: 'account', key: 'attachmentsUploadsUploadLocation', access: 'read_write' }, titleKey: 'settingsAttachments.uploadLocation.rowTitle', keywordKeys: ['settingsAttachments.uploadLocation.options.osTemp.title'] },
                uploadsDirectory: { titleKey: 'settingsAttachments.workspaceDirectory.uploadsDirectory.title' },
            },
        },
        sourceControlIgnore: {
            titleKey: 'settingsAttachments.sourceControlIgnore.title',
            settings: {
                ignoreStrategy: { storage: { scope: 'account', key: 'attachmentsUploadsVcsIgnoreStrategy', access: 'read_write' }, titleKey: 'settingsAttachments.sourceControlIgnore.rowTitle', keywordKeys: ['settingsAttachments.sourceControlIgnore.options.gitignore.title'] },
                writeIgnoreRules: { storage: { scope: 'account', key: 'attachmentsUploadsVcsIgnoreWritesEnabled', access: 'read_write' }, titleKey: 'settingsAttachments.sourceControlIgnore.writeIgnoreRules.title', descriptionKey: 'settingsAttachments.sourceControlIgnore.writeIgnoreRules.subtitle' },
            },
        },
        limits: {
            titleKey: 'settingsAttachments.limits.title',
            settings: {
                maxAttachmentSize: { storage: { scope: 'account', key: 'attachmentsUploadsMaxFileBytes', access: 'read_write' }, titleKey: 'settingsAttachments.limits.maxAttachmentSize.title' },
            },
        },
    },
});
