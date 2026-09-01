import * as React from 'react';
import { Platform } from 'react-native';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { type ItemAction } from '@/components/ui/lists/itemActions';
import { t } from '@/text';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';
import { resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import type { ServerSelectionGroup } from '@/sync/domains/server/selection/serverSelectionTypes';
import { useUnistyles } from 'react-native-unistyles';
import { Icon } from '@/components/ui/icons/Icon';

type SavedServersSectionProps = Readonly<{
    servers: ReadonlyArray<ServerProfile>;
    serverGroups?: ReadonlyArray<ServerSelectionGroup>;
    activeServerId: string;
    deviceDefaultServerId?: string | null;
    activeTargetKey?: string | null;
    authStatusByServerId: Record<string, 'signedIn' | 'signedOut' | 'unknown'>;
    connectionStatusByServerId?: Readonly<Record<string, 'connected' | 'connecting' | 'disconnected' | 'error' | 'unknown'>>;
    onSwitch: (profile: ServerProfile, scope?: 'tab' | 'device') => Promise<void> | void;
    onSwitchGroup?: (profile: ServerSelectionGroup) => Promise<void> | void;
    onRenameGroup?: (profile: ServerSelectionGroup) => Promise<void> | void;
    onRemoveGroup?: (profile: ServerSelectionGroup) => Promise<void> | void;
    onRename: (profile: ServerProfile) => Promise<void> | void;
    onRemove: (profile: ServerProfile) => Promise<void> | void;
}>;

export function SavedServersSection(props: SavedServersSectionProps) {
    const { theme } = useUnistyles();
    const groups = Array.isArray(props.serverGroups) ? props.serverGroups : [];
    const homeNameCounts = new Map<string, number>();
    for (const profile of props.servers) {
        const key = profile.name.trim().toLocaleLowerCase();
        homeNameCounts.set(key, (homeNameCounts.get(key) ?? 0) + 1);
    }
    return (
        <ItemGroup title={t('server.savedServersTitle')}>
            {groups.map((group) => {
                const targetKey = `group:${group.id}`;
                const isSelected = props.activeTargetKey ? props.activeTargetKey === targetKey : false;
                const actions: ItemAction[] = [
                    {
                        id: 'switch',
                        title: t('server.switchToServer'),
                        accessibilityLabel: `${t('server.switchToServer')}: ${group.name}`,
                        icon: 'arrows-left-right',
                        onPress: () => props.onSwitchGroup?.(group),
                    },
                    {
                        id: 'rename',
                        title: t('common.rename'),
                        accessibilityLabel: `${t('common.rename')}: ${group.name}`,
                        icon: 'pencil',
                        onPress: () => props.onRenameGroup?.(group),
                    },
                    {
                        id: 'remove',
                        title: t('common.remove'),
                        accessibilityLabel: `${t('common.remove')}: ${group.name}`,
                        icon: 'trash',
                        destructive: true,
                        onPress: () => props.onRemoveGroup?.(group),
                    },
                ];
                  return (
                      <Item
                          key={targetKey}
                          title={group.name}
                          subtitle={t('server.serverCount', { count: group.serverIds.length })}
                          icon={<Icon name="stack" size={16} color={theme.colors.text.secondary} />}
                          selected={isSelected}
                          showChevron={false}
                          detail={isSelected ? t('server.active') : undefined}
                          onPress={undefined}
                          rightElement={(
                            <ItemRowActions
                                title={group.name}
                                actions={actions}
                                compactActionIds={['switch']}
                                pinnedActionIds={['switch']}
                                overflowPosition="beforePinned"
                            />
                        )}
                    />
                );
            })}
            {props.servers.map((profile) => {
                const scopeId = resolveServerProfileScopeId(profile);
                const targetKey = `server:${scopeId}`;
                const isActive = props.activeTargetKey
                    ? props.activeTargetKey === targetKey
                    : scopeId === props.activeServerId || profile.id === props.activeServerId;
                const authStatus = props.authStatusByServerId[scopeId]
                    ?? props.authStatusByServerId[profile.id]
                    ?? 'unknown';
                const statusLabel =
                    authStatus === 'signedIn'
                        ? t('server.signedIn')
                        : authStatus === 'signedOut'
                            ? t('server.signedOut')
                            : t('server.authStatusUnknown');
                const connectionStatus = props.connectionStatusByServerId?.[scopeId] ?? props.connectionStatusByServerId?.[profile.id];
                const connectionStatusLabel = authStatus === 'signedIn' && connectionStatus
                    ? t(`status.${connectionStatus}` as 'status.connected' | 'status.connecting' | 'status.disconnected' | 'status.error' | 'status.unknown')
                    : null;
                const subtitle = connectionStatusLabel ?? statusLabel;
                const hasDuplicateName = (homeNameCounts.get(profile.name.trim().toLocaleLowerCase()) ?? 0) > 1;
                const accessibleHomeName = hasDuplicateName
                    ? `${profile.name}, ${toServerUrlDisplay(profile.serverUrl)}`
                    : profile.name;
                const actions: ItemAction[] = Platform.OS === 'web'
                    ? [
                        {
                            id: 'switch-tab',
                            title: t('server.switchForThisTab'),
                            accessibilityLabel: `${t('server.switchForThisTab')}: ${accessibleHomeName}`,
                            icon: 'arrows-left-right',
                            onPress: () => props.onSwitch(profile, 'tab'),
                        },
                        {
                            id: 'switch-device',
                            title: t('server.makeDefaultOnDevice'),
                            accessibilityLabel: `${t('server.makeDefaultOnDevice')}: ${accessibleHomeName}`,
                            icon: 'device-mobile',
                            inlineTestID: `saved-server-switch-${profile.id}`,
                            onPress: () => props.onSwitch(profile, 'device'),
                        },
                        {
                            id: 'rename',
                            title: t('common.rename'),
                            accessibilityLabel: `${t('common.rename')}: ${accessibleHomeName}`,
                            icon: 'pencil',
                            onPress: () => props.onRename(profile),
                        },
                        {
                            id: 'remove',
                            title: t('common.remove'),
                            accessibilityLabel: `${t('common.remove')}: ${accessibleHomeName}`,
                            icon: 'trash',
                            destructive: true,
                            onPress: () => props.onRemove(profile),
                        },
                    ]
                    : [
                        {
                            id: 'switch',
                            title: t('server.switchToServer'),
                            accessibilityLabel: `${t('server.switchToServer')}: ${accessibleHomeName}`,
                            icon: 'arrows-left-right',
                            inlineTestID: `saved-server-switch-${profile.id}`,
                            onPress: () => props.onSwitch(profile, 'device'),
                        },
                        {
                            id: 'rename',
                            title: t('common.rename'),
                            accessibilityLabel: `${t('common.rename')}: ${accessibleHomeName}`,
                            icon: 'pencil',
                            onPress: () => props.onRename(profile),
                        },
                        {
                            id: 'remove',
                            title: t('common.remove'),
                            accessibilityLabel: `${t('common.remove')}: ${accessibleHomeName}`,
                            icon: 'trash',
                            destructive: true,
                            onPress: () => props.onRemove(profile),
                        },
                    ];

                return (
                    <Item
                        key={profile.id}
                        testID={`saved-server-row-${profile.id}`}
                        title={profile.name}
                        titleLines={1}
                        titleEllipsizeMode="tail"
                        subtitle={subtitle}
                        subtitleLines={0}
                        icon={<Icon name="hard-drives" size={16} color={theme.colors.text.secondary} />}
                        selected={isActive}
                        showChevron={false}
                        detail={undefined}
                        accessibilityLabel={`${accessibleHomeName}, ${subtitle}`}
                        onPress={undefined}
                        rightElement={(
                            <ItemRowActions
                                title={accessibleHomeName}
                                actions={actions}
                                compactActionIds={Platform.OS === 'web' ? ['switch-device'] : ['switch']}
                                pinnedActionIds={Platform.OS === 'web' ? ['switch-device'] : ['switch']}
                                overflowPosition="beforePinned"
                            />
                        )}
                    />
                );
            })}
        </ItemGroup>
    );
}
