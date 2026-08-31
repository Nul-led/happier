import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text, TextInput } from '@/components/ui/text/Text';
import { t } from '@/text';
import {
    normalizeSessionHandoffDefaults,
    parseSessionHandoffIgnoredIncludeGlobs,
    SESSION_HANDOFF_DIRECT_TARGET_MODE_OPTIONS,
    SESSION_HANDOFF_INCLUDE_IGNORED_MODE_OPTIONS,
    SESSION_HANDOFF_WORKSPACE_SYNC_MODE_OPTIONS,
    type SessionHandoffDefaultsV1,
    type SessionHandoffWorkspaceMode,
} from '@/sync/domains/sessionHandoff/sessionHandoffDefaults';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { Icon } from '@/components/ui/icons/Icon';
import { WorkspaceSyncRelationshipList } from '@/components/workspaces/sync/WorkspaceSyncRelationshipList';

export const SessionHandoffSettingsView = React.memo(function SessionHandoffSettingsView() {
    const { theme } = useUnistyles();
    const popoverBoundaryRef = React.useRef<any>(null);
    const [rawDefaults, setRawDefaults] = useSettingMutable('sessionHandoffDefaultsV1');
    const defaults = React.useMemo(() => normalizeSessionHandoffDefaults(rawDefaults), [rawDefaults]);
    const defaultsRef = React.useRef(defaults);
    const [openWorkspaceModeMenu, setOpenWorkspaceModeMenu] = React.useState(false);
    const [openIgnoredModeMenu, setOpenIgnoredModeMenu] = React.useState(false);
    const [openDirectModeMenu, setOpenDirectModeMenu] = React.useState(false);

    React.useEffect(() => {
        defaultsRef.current = defaults;
    }, [defaults]);

    const updateDefaults = React.useCallback((patch: Partial<SessionHandoffDefaultsV1>) => {
        const next = {
            ...defaultsRef.current,
            ...patch,
        };
        defaultsRef.current = next;
        setRawDefaults(next);
    }, [setRawDefaults]);

    const selectedWorkspaceMode = React.useMemo(
        () => SESSION_HANDOFF_WORKSPACE_SYNC_MODE_OPTIONS.find((option) => option.id === defaults.workspaceSyncMode)
            ?? SESSION_HANDOFF_WORKSPACE_SYNC_MODE_OPTIONS[0],
        [defaults.workspaceSyncMode],
    );

    return (
        <ItemList ref={popoverBoundaryRef} style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t('settingsSession.handoff.groupTitle')}
                footer={t('settingsSession.handoff.groupFooter')}
            >
                <DropdownMenu
                    open={openWorkspaceModeMenu}
                    onOpenChange={setOpenWorkspaceModeMenu}
                    variant="selectable"
                    search={false}
                    selectedId={defaults.workspaceSyncMode}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    popoverBoundaryRef={popoverBoundaryRef}
                    itemTrigger={{
                        title: t('settingsSession.handoff.workspaceMode.title'),
                        subtitle: t(selectedWorkspaceMode.subtitleKey),
                        icon: <Icon name="folder-open" size={29} color={theme.colors.accent.blue} />,
                        itemProps: { testID: 'session-handoff-workspace-sync-mode-trigger' },
                    }}
                    items={SESSION_HANDOFF_WORKSPACE_SYNC_MODE_OPTIONS.map((item) => ({
                        id: item.id,
                        title: t(item.titleKey),
                        subtitle: t(item.subtitleKey),
                        icon: (
                            <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                                <Icon
                                    name={item.id === 'mirror_exactly' ? 'warning' : item.id === 'none' ? 'eye-slash' : 'folder'}
                                    size={20}
                                    color={theme.colors.text.secondary}
                                />
                            </View>
                        ),
                    }))}
                    onSelect={(itemId) => {
                        const nextMode = itemId as SessionHandoffWorkspaceMode;
                        updateDefaults({
                            workspaceSyncMode: nextMode,
                            workspaceSyncRelationshipId: null,
                        });
                        setOpenWorkspaceModeMenu(false);
                    }}
                />
                <DropdownMenu
                    open={openIgnoredModeMenu}
                    onOpenChange={setOpenIgnoredModeMenu}
                    variant="selectable"
                    search={false}
                    selectedId={defaults.includeIgnoredMode}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    popoverBoundaryRef={popoverBoundaryRef}
                    itemTrigger={{
                        title: t('settingsSession.handoff.includeIgnoredMode.title'),
                        subtitle: t('settingsSession.handoff.includeIgnoredMode.subtitle'),
                        icon: <Icon name="funnel-simple" size={29} color={theme.colors.accent.indigo} />,
                        itemProps: { testID: 'session-handoff-ignored-mode-trigger' },
                    }}
                    items={SESSION_HANDOFF_INCLUDE_IGNORED_MODE_OPTIONS.map((item) => ({
                        id: item.id,
                        title: t(item.titleKey),
                        subtitle: t(item.subtitleKey),
                        icon: (
                            <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                                <Icon
                                    name={item.id === 'include_selected' ? 'funnel-simple' : 'eye-slash'}
                                    size={20}
                                    color={theme.colors.text.secondary}
                                />
                            </View>
                        ),
                    }))}
                    onSelect={(itemId) => {
                        updateDefaults({ includeIgnoredMode: itemId as SessionHandoffDefaultsV1['includeIgnoredMode'] });
                        setOpenIgnoredModeMenu(false);
                    }}
                />
                {defaults.includeIgnoredMode === 'include_selected' ? (
                    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
                        <Text style={{ fontSize: 14, marginBottom: 8, color: theme.colors.text.secondary }}>
                            {t('settingsSession.handoff.includeIgnoredMode.globsTitle')}
                        </Text>
                        <TextInput
                            accessibilityLabel={t('settingsSession.handoff.includeIgnoredMode.globsTitle')}
                            value={defaults.ignoredIncludeGlobs.join(', ')}
                            onChangeText={(value) => updateDefaults({ ignoredIncludeGlobs: parseSessionHandoffIgnoredIncludeGlobs(value) })}
                            placeholder={t('settingsSession.handoff.includeIgnoredMode.globsPlaceholder')}
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={{
                                minHeight: 44,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: theme.colors.border.default,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                color: theme.colors.text.primary,
                            }}
                        />
                    </View>
                ) : null}
            </ItemGroup>

            <ItemGroup
                title={t('settingsSession.handoff.directTargetMode.groupTitle')}
                footer={t('settingsSession.handoff.directTargetMode.groupFooter')}
            >
                <DropdownMenu
                    open={openDirectModeMenu}
                    onOpenChange={setOpenDirectModeMenu}
                    variant="selectable"
                    search={false}
                    selectedId={defaults.directTargetMode}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    popoverBoundaryRef={popoverBoundaryRef}
                    itemTrigger={{
                        title: t('settingsSession.handoff.directTargetMode.title'),
                        subtitle: t('settingsSession.handoff.directTargetMode.subtitle'),
                        icon: <Icon name="arrows-left-right" size={29} color={theme.colors.accent.green} />,
                    }}
                    items={SESSION_HANDOFF_DIRECT_TARGET_MODE_OPTIONS.map((item) => ({
                        id: item.id,
                        title: t(item.titleKey),
                        subtitle: t(item.subtitleKey),
                        icon: (
                            <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                                <Icon
                                    name={item.id === 'convert_to_persisted' ? 'floppy-disk' : 'arrow-right'}
                                    size={20}
                                    color={theme.colors.text.secondary}
                                />
                            </View>
                        ),
                    }))}
                    onSelect={(itemId) => {
                        updateDefaults({ directTargetMode: itemId as SessionHandoffDefaultsV1['directTargetMode'] });
                        setOpenDirectModeMenu(false);
                    }}
                />
            </ItemGroup>

            <WorkspaceSyncRelationshipList />
        </ItemList>
    );
});

export default SessionHandoffSettingsView;
