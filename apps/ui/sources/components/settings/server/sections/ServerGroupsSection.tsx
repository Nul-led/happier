import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SettingAnchor } from '@/components/settings/shell/SettingRow';
import { SERVERS_SETTINGS } from '@/components/settings/server/serverSettings';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';

type ServerGroupsSectionProps = Readonly<{
    groupSelectionPresentation: 'grouped' | 'flat-with-badge';
    /** The group whose membership is being edited. It does not have to be the active target. */
    groupId: string | null;
    groupName?: string | null;
    selectedGroupServerIds: ReadonlySet<string>;
    servers: ReadonlyArray<ServerProfile>;
    onToggleGroupPresentation: () => void;
    onToggleGroupServer: (serverId: string) => void;
}>;

export function ServerGroupsSection(props: ServerGroupsSectionProps) {
    const { theme } = useUnistyles();
    if (!props.groupId) return null;
    const groupName = props.groupName?.trim();

    return (
        <ItemGroup
            title={groupName ? `${t('server.multiServerView.editMembersAction')}: ${groupName}` : t('server.multiServerView.title')}
            description={t('server.multiServerView.footer')}
        >
            <SettingAnchor setting={SERVERS_SETTINGS.settings.groupPresentation}>
                <SegmentedChoiceItem<'flat-with-badge' | 'grouped'>
                    testID="server-group-presentation"
                    testIDPrefix="server-group-presentation"
                    title={t(SERVERS_SETTINGS.settings.groupPresentation.titleKey)}
                    options={[
                        { id: 'flat-with-badge', label: t('server.multiServerView.presentationChoice.flat'), description: t('server.multiServerView.presentationChoice.flatDescription') },
                        { id: 'grouped', label: t('server.multiServerView.presentationChoice.grouped'), description: t('server.multiServerView.presentationChoice.groupedDescription') },
                    ]}
                    value={props.groupSelectionPresentation}
                    onChange={(next) => {
                        if (next !== props.groupSelectionPresentation) props.onToggleGroupPresentation();
                    }}
                />
            </SettingAnchor>
            {props.servers.map((profile) => {
                    const scopeId = resolveServerProfileScopeId(profile);
                    const selected = props.selectedGroupServerIds.has(scopeId);
                    return (
                        <Item
                            key={`multi-server-${profile.id}`}
                            testID={`server-group-member-${profile.id}`}
                            title={resolveHomeDisplayLabel(profile, profile.id)}
                            subtitle={toServerUrlDisplay(profile.serverUrl)}
                            rightElement={(
                                <Icon
                                    name={selected ? 'check-circle' : 'circle'}
                                    size={20}
                                    color={selected ? theme.colors.status.connected : theme.colors.text.secondary}
                                />
                            )}
                            accessibilityRole="checkbox"
                            webRole="checkbox"
                            selected={selected}
                            showChevron={false}
                            onPress={() => props.onToggleGroupServer(scopeId)}
                        />
                    );
            })}
        </ItemGroup>
    );
}
