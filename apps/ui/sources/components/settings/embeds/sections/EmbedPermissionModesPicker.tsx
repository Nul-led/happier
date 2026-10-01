import * as React from 'react';
import type { SessionPermissionMode } from '@happier-dev/protocol';

import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import type { AgentType } from '@/sync/domains/models/modelOptions';
import { getPermissionModeOptionsForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import { t } from '@/text';

import type { EmbedDraft } from '../embedDraft';

/**
 * The permission modes chats may use (`grant.permissionModes`, enforced). The choices are the
 * agent's own mode catalogue; with more than one allowed, the chat shows a picker limited to them.
 */
export const EmbedPermissionModesPicker = React.memo(function EmbedPermissionModesPicker(props: Readonly<{
    draft: EmbedDraft;
    onChange: (next: EmbedDraft) => void;
    agentType: AgentType;
    onDone: () => void;
}>) {
    const options = getPermissionModeOptionsForAgentType(props.agentType);
    const modes = props.draft.access.permissionModes;
    const setModes = (next: readonly SessionPermissionMode[] | null) => {
        props.onChange({ ...props.draft, access: { ...props.draft.access, permissionModes: next && next.length > 0 ? [...next] : null } });
    };
    return (
        <ItemList presentation="page" testID="settings-embed-permission-modes-picker">
            <SettingsPageHeader
                title={t('settingsEmbeds.capabilities.permissionModes')}
                description={t('settingsEmbeds.capabilities.permissionModesDescription')}
                alwaysShowTitle
                cancelAction={{ title: t('common.done'), onPress: props.onDone }}
            />
            <ItemGroup>
                <Item
                    title={t('settingsEmbeds.capabilities.anyMode')}
                    // An explicit choice: it lets people skip the approvals the default mode keeps.
                    subtitle={t('settingsEmbeds.capabilities.anyModeDescription')}
                    subtitleLines={0}
                    showChevron={false}
                    rightElement={(
                        <Switch
                            accessibilityLabel={t('settingsEmbeds.capabilities.anyMode')}
                            value={modes === null}
                            onValueChange={(any) => setModes(any ? null : [options[0]?.value ?? 'default'])}
                        />
                    )}
                />
            </ItemGroup>
            {modes !== null ? (
                <ItemGroup>
                    {options.map((option) => {
                        const selected = modes.includes(option.value);
                        return (
                            <Item
                                key={option.value}
                                testID={`settings-embed-permission-mode:${option.value}`}
                                title={option.label}
                                subtitle={option.description}
                                showChevron={false}
                                accessibilityRole="checkbox"
                                accessibilityChecked={selected}
                                rightElement={(
                                    <Switch
                                        accessibilityLabel={option.label}
                                        value={selected}
                                        // The last allowed mode cannot be removed here; "Any mode" is the other way out.
                                        disabled={selected && modes.length === 1}
                                        onValueChange={(on) => setModes(on ? [...modes, option.value] : modes.filter((mode) => mode !== option.value))}
                                    />
                                )}
                            />
                        );
                    })}
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});
