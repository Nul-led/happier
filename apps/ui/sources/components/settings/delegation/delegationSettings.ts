import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `delegation` page. Rows render their labels from these declarations. */
export const DELEGATION_SETTINGS = defineSettingsPage({
    pageId: 'delegation',
    sections: {
        approvalReviewer: {
            titleKey: 'roles.delegation.approvalReviewer',
            settings: {
                approvalReviewerEnabled: { storage: { scope: 'account', key: 'approvalReviewerEnabled', access: 'read_write' }, titleKey: 'roles.delegation.approvalReviewer', descriptionKey: 'roles.delegation.approvalReviewerDescription' },
            },
        },
        workDepth: {
            titleKey: 'roles.delegation.depthTitle',
            settings: {
                workDepthLimit: { storage: { scope: 'account', key: 'workDepthLimit', access: 'read_write' }, titleKey: 'roles.delegation.depthSetting', keywordKeys: ['roles.delegation.ladderRefused'] },
            },
        },
    },
});
