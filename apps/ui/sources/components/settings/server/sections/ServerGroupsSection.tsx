import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

type ServerGroupsSectionProps = Readonly<{
    groupSelectionPresentation: 'grouped' | 'flat-with-badge';
    activeServerGroupId: string | null;
    selectedGroupServerIds: ReadonlySet<string>;
    servers: ReadonlyArray<ServerProfile>;
    onToggleGroupPresentation: () => void;
    onToggleGroupServer: (serverId: string) => void;
}>;

export function ServerGroupsSection(props: ServerGroupsSectionProps) {
    const { theme } = useUnistyles();
    if (!props.activeServerGroupId) return null;

    return (
        <ItemGroup
            title={t('server.multiServerView.title')}
            footer={t('server.multiServerView.footer')}
        >
            <Item
                title={t('server.multiServerView.presentationTitle')}
                subtitle={
                    props.groupSelectionPresentation === 'flat-with-badge'
                        ? t('server.multiServerView.presentation.flatWithBadges')
                        : t('server.multiServerView.presentation.groupedByServer')
                }
                icon={<Icon name="list" size={29} color={theme.colors.text.secondary} />}
                rightElement={<Icon name="arrows-left-right" size={20} color={theme.colors.text.secondary} />}
                showChevron={false}
                onPress={props.onToggleGroupPresentation}
            />
            {props.servers.map((profile) => {
                    const scopeId = resolveServerProfileScopeId(profile);
                    const selected = props.selectedGroupServerIds.has(scopeId);
                    return (
                        <Item
                            key={`multi-server-${profile.id}`}
                            testID={`server-group-member-${profile.id}`}
                            title={profile.name}
                            subtitle={toServerUrlDisplay(profile.serverUrl)}
                            icon={<Icon name="hard-drives" size={29} color={theme.colors.text.secondary} />}
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
