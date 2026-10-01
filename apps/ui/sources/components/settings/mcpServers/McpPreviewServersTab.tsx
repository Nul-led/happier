import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { DaemonMcpServersPreviewResponse } from '@happier-dev/protocol';
import type { AgentCoreConfig, AgentId } from '@/agents/registry/registryCore';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { PathInputBrowseButton } from '@/components/ui/pathBrowser/PathInputBrowseButton';
import { openMachinePathBrowserModal } from '@/components/ui/pathBrowser/openMachinePathBrowserModal';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { t } from '@/text';

import { McpServerBadgePills } from './McpServerBadgePills';
import {
    resolveAgentToolsDeliveryDescription,
    resolveAgentToolsDeliveryLabel,
    resolveAuthBadgeLabel,
    resolveDetectedAvailabilityLabel,
    resolveManagedAvailabilityLabel,
    resolvePreviewScopeLabel,
    resolveTransportLabel,
} from './mcpServerUi';
import { SettingRow, SettingAnchor } from '@/components/settings/shell/SettingRow';
import { MCP_PREVIEW_SETTINGS } from '@/components/settings/mcpServers/mcpSettings';

type PreviewSuccess = Extract<DaemonMcpServersPreviewResponse, { ok: true }>;

export const McpPreviewServersTab = React.memo(function McpPreviewServersTab(props: Readonly<{
    agentItems: readonly DropdownMenuItem[];
    /** Null when the selected Agent contributes no bundled tools declaration. */
    selectedAgentTools: AgentCoreConfig['tools'] | null;
    selectedMachineId: string | null;
    selectedServerId: string | null;
    canExecute: boolean;
    selectedAgentId: AgentId;
    onSelectAgentId: (agentId: AgentId) => void;
    agentMenuOpen: boolean;
    onAgentMenuOpenChange: (open: boolean) => void;
    directory: string;
    onChangeDirectory: (value: string) => void;
    loading: boolean;
    preview: PreviewSuccess | null;
    onRefresh: () => void;
}>) {

    const handleBrowseDirectory = React.useCallback(async () => {
        if (!props.selectedMachineId || !props.selectedServerId || !props.canExecute) return;
        const selected = await openMachinePathBrowserModal({
            machineId: props.selectedMachineId,
            serverId: props.selectedServerId,
            initialPath: props.directory,
            title: t('settings.mcpServersPreviewDirectoryTitle'),
        });
        if (selected) {
            props.onChangeDirectory(selected);
        }
    }, [props.canExecute, props.directory, props.onChangeDirectory, props.selectedMachineId, props.selectedServerId]);

    const renderPreviewRow = (entry: Readonly<{
        key: string;
        title?: string | null;
        name: string;
        transport: Parameters<typeof resolveTransportLabel>[0];
        authMode: Parameters<typeof resolveAuthBadgeLabel>[0];
    }>, facts: readonly string[], badge?: Readonly<{ label: string; tone: 'success' | 'accent' | 'warning' }>) => (
        <Item
            key={entry.key}
            title={entry.title || entry.name}
            subtitle={[...facts, resolveTransportLabel(entry.transport), resolveAuthBadgeLabel(entry.authMode)].filter(Boolean).join(' · ')}
            subtitleLines={0}
            rightElement={badge ? (
                <McpServerBadgePills badges={[{ key: `${entry.key}:state`, label: badge.label, tone: badge.tone }]} />
            ) : undefined}
            showChevron={false}
            mode="info"
        />
    );

    return (
        <>
            <ItemGroup
                title={t('mcpSettings.previewContextSection')}
                description={t('mcpSettings.previewContextDescription')}
                action={(
                    <SectionActionButton
                        testID="settings.mcpServers.preview.refresh"
                        icon="arrow-clockwise"
                        title={t('mcpSettings.check')}
                        loading={props.loading}
                        disabled={props.loading || !props.canExecute}
                        onPress={props.onRefresh}
                    />
                )}
            >
                <SettingAnchor setting={MCP_PREVIEW_SETTINGS.settings.mcpServersPreviewAgent}>
                    <DropdownMenu
                        open={props.agentMenuOpen}
                        onOpenChange={props.onAgentMenuOpenChange}
                        items={props.agentItems}
                        selectedId={props.selectedAgentId}
                        onSelect={(agentId) => props.onSelectAgentId(agentId as AgentId)}
                        itemTrigger={{
                            title: t(MCP_PREVIEW_SETTINGS.settings.mcpServersPreviewAgent.titleKey),
                        }}
                        rowKind="item"
                        connectToTrigger
                        variant="selectable"
                        search={false}
                        showCategoryTitles={false}
                        matchTriggerWidth
                    />
                </SettingAnchor>
                {props.selectedAgentTools ? (
                    <Item
                        testID="settings.mcpServers.preview.delivery"
                        title={t('settings.mcpServersPreviewDeliveryTitle')}
                        subtitle={resolveAgentToolsDeliveryDescription(props.selectedAgentTools.delivery)}
                        subtitleLines={0}
                        detail={resolveAgentToolsDeliveryLabel(props.selectedAgentTools.delivery)}
                        showChevron={false}
                        mode="info"
                    />
                ) : null}
                <SettingRow
                    testID="settings.mcpServers.preview.directory"
                    setting={MCP_PREVIEW_SETTINGS.settings.mcpServersPreviewDirectory}
                    showChevron={false}
                    accessoryLayout="adaptive"
                    rightElement={(
                        <View style={styles.directoryInputRow}>
                            <FieldTextInput
                                testID="settings.mcpServers.preview.directoryInput"
                                style={styles.directoryInput}
                                value={props.directory}
                                onChangeText={props.onChangeDirectory}
                                accessibilityLabel={t('settings.mcpServersPreviewDirectoryTitle')}
                                placeholder={t('settings.mcpServersPreviewDirectoryPlaceholder')}
                                monospace
                            />
                            <PathInputBrowseButton
                                onPress={handleBrowseDirectory}
                                disabled={!props.canExecute}
                            />
                        </View>
                    )}
                />
            </ItemGroup>

            {!props.preview ? (
                <ItemGroup>
                    <Item
                        testID="settings.mcpServers.preview.empty"
                        title={t('settings.mcpServersPreviewEmptyTitle')}
                        subtitle={t('settings.mcpServersPreviewEmptySubtitle')}
                        subtitleLines={0}
                        showChevron={false}
                        mode="info"
                    />
                </ItemGroup>
            ) : props.preview.builtIn.length + props.preview.managed.length + props.preview.detected.length === 0 ? (
                // Checked, and no source has a server for this agent and folder: say so, rather than
                // leaving the page looking as if nothing was checked.
                <ItemGroup>
                    <Item
                        testID="settings.mcpServers.preview.nothing"
                        title={t('mcpSettings.previewNothingTitle')}
                        subtitle={t('mcpSettings.previewNothingDescription')}
                        subtitleLines={0}
                        showChevron={false}
                        mode="info"
                    />
                </ItemGroup>
            ) : (
                <>
                    {props.preview.builtIn.length > 0 ? (
                        <ItemGroup title={t('settings.mcpServersSourceBuiltIn')} description={t('settings.mcpServersBuiltInDescription')}>
                            {props.preview.builtIn.map((entry) => renderPreviewRow(entry, [resolvePreviewScopeLabel(entry.scopeKind)]))}
                        </ItemGroup>
                    ) : null}
                    {props.preview.managed.length > 0 ? (
                        <ItemGroup title={t('settings.mcpServersSourceHappier')}>
                            {props.preview.managed.map((entry) => renderPreviewRow(
                                entry,
                                [resolvePreviewScopeLabel(entry.scopeKind)],
                                { label: resolveManagedAvailabilityLabel(entry), tone: entry.selected ? 'success' : 'accent' },
                            ))}
                        </ItemGroup>
                    ) : null}
                    {props.preview.detected.length > 0 ? (
                        <ItemGroup title={t('settings.mcpServersSourceDetected')}>
                            {props.preview.detected.map((entry) => renderPreviewRow(
                                entry,
                                [`${entry.provider} · ${resolvePreviewScopeLabel(entry.scopeKind)}`, entry.sourcePath],
                                { label: resolveDetectedAvailabilityLabel(entry), tone: 'warning' },
                            ))}
                        </ItemGroup>
                    ) : null}
                </>
            )}
        </>
    );
});

const styles = StyleSheet.create(() => ({
    directoryInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexShrink: 1,
    },
    directoryInput: {
        flex: 1,
        minWidth: 0,
    },
}));
