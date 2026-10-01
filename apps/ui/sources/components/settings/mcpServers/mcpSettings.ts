import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';

/**
 * The searchable settings of the MCP collection. Servers are collection items, not settings; the
 * settings live on the collection's two tool pages, each declared as a sub-page of `mcp`.
 */
export const MCP_ON_MACHINE_SETTINGS = defineSettingsPage({
    pageId: 'mcp',
    subpage: { id: 'onMachine', route: SETTINGS_ROUTES.mcpOnMachine, titleKey: 'mcpSettings.onMachineTitle' },
    sections: {
        mcpServersDetected: {
            titleKey: 'mcpSettings.onMachineSearchSection',
            settings: {
                mcpServersDetectedDirectory: { titleKey: 'settings.mcpServersDetectedDirectoryTitle', descriptionKey: 'settings.mcpServersDetectedDirectorySubtitle' },
            },
        },
    },
});

export const MCP_PREVIEW_SETTINGS = defineSettingsPage({
    pageId: 'mcp',
    subpage: { id: 'preview', route: SETTINGS_ROUTES.mcpPreview, titleKey: 'mcpSettings.previewTitle' },
    sections: {
        mcpServersSegmentPreview: {
            titleKey: 'mcpSettings.previewContextSection',
            settings: {
                mcpServersPreviewAgent: { titleKey: 'settings.mcpServersPreviewAgentTitle' },
                mcpServersPreviewDirectory: { titleKey: 'settings.mcpServersPreviewDirectoryTitle', descriptionKey: 'settings.mcpServersPreviewDirectorySubtitle' },
            },
        },
        mcpServersReliability: {
            titleKey: 'mcpSettings.failureSection',
            settings: {
                mcpServersStrictMode: {
                    titleKey: 'mcpSettings.failurePolicyTitle',
                    descriptionKey: 'mcpSettings.failurePolicyDescription',
                    keywordKeys: ['settings.mcpServersStrictMode'],
                },
            },
        },
    },
});
