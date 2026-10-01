import * as React from 'react';

import { IconButton } from '@/components/ui/buttons/IconButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { listMcpQuickInstallPresets } from '@/sync/domains/settings/mcpServers/mcpQuickInstallCatalog';
import { t } from '@/text';

import { MCP_ON_MACHINE_ROUTE, newMcpServerRoute } from './mcpServerCollectionModel';

const CONFIGURE_ID = 'configure';
const IMPORT_JSON_ID = 'import-json';
const FROM_MACHINE_ID = 'from-machine';
const PRESET_PREFIX = 'preset:';

/**
 * The collection's "+": configure a server yourself, paste a JSON config, start from a preset, or
 * import one another agent already uses on this machine. Each opens its editor in the detail pane.
 */
export const AddMcpServerMenu = React.memo(function AddMcpServerMenu(props: Readonly<{
    onAdd: (href: string) => void;
    /** Replaces the "+" trigger (a button in an empty collection's invitation). */
    renderTrigger?: (toggle: () => void) => React.ReactNode;
}>) {
    const [open, setOpen] = React.useState(false);
    const items = React.useMemo((): ReadonlyArray<DropdownMenuItem> => [
        {
            id: CONFIGURE_ID,
            testID: 'settings.mcpServers.add.configure',
            title: t('mcpSettings.addConfigure'),
            subtitle: t('mcpSettings.addConfigureDescription'),
            category: t('mcpSettings.addOwnCategory'),
        },
        {
            id: IMPORT_JSON_ID,
            testID: 'settings.mcpServers.add.importJson',
            title: t('mcpSettings.addImportJson'),
            subtitle: t('mcpSettings.addImportJsonDescription'),
            category: t('mcpSettings.addOwnCategory'),
        },
        {
            id: FROM_MACHINE_ID,
            testID: 'settings.mcpServers.add.fromMachine',
            title: t('mcpSettings.addFromMachine'),
            subtitle: t('mcpSettings.addFromMachineDescription'),
            category: t('mcpSettings.addOwnCategory'),
        },
        ...listMcpQuickInstallPresets().map((preset): DropdownMenuItem => ({
            id: `${PRESET_PREFIX}${preset.id}`,
            testID: `settings.mcpServers.quickInstall.${preset.id}`,
            title: preset.title,
            subtitle: preset.description,
            category: t('mcpSettings.addPresetCategory'),
        })),
    ], []);
    return (
        <DropdownMenu
            testID="settings.mcpServers.addMenu"
            open={open}
            onOpenChange={setOpen}
            items={items}
            onSelect={(id) => {
                setOpen(false);
                if (id === CONFIGURE_ID) props.onAdd(newMcpServerRoute('configure'));
                else if (id === IMPORT_JSON_ID) props.onAdd(newMcpServerRoute('import-json'));
                else if (id === FROM_MACHINE_ID) props.onAdd(MCP_ON_MACHINE_ROUTE);
                else if (id.startsWith(PRESET_PREFIX)) props.onAdd(newMcpServerRoute('quick-install', id.slice(PRESET_PREFIX.length)));
            }}
            placement="bottom"
            popoverAnchorAlign="end"
            matchTriggerWidth={false}
            maxWidthCap={340}
            showCategoryTitles
            popoverPortalWebTarget="body"
            trigger={({ toggle }) => props.renderTrigger ? props.renderTrigger(toggle) : (
                <IconButton
                    testID="settings.mcpServers.addServer"
                    iconName="plus"
                    accessibilityLabel={t('mcpSettings.add')}
                    tooltip={t('mcpSettings.add')}
                    variant="plain"
                    onPress={toggle}
                />
            )}
        />
    );
});
