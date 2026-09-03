import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import type { PluginUpdatePolicyV1 } from '@happier-dev/protocol/marketplace';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

import type { InstalledPluginEntry } from '../model/pluginMarketplaceModel';

const NPM_POLICIES = Object.freeze([
    'pinned',
    'reviewEveryUpdate',
    'reviewSensitiveChanges',
] satisfies readonly PluginUpdatePolicyV1[]);
const OTHER_POLICIES = Object.freeze([
    'pinned',
    'reviewEveryUpdate',
] satisfies readonly PluginUpdatePolicyV1[]);

function policyTitle(policy: PluginUpdatePolicyV1): string {
    if (policy === 'pinned') return t('settingsPlugins.updatePolicy.pinned');
    if (policy === 'reviewEveryUpdate') return t('settingsPlugins.updatePolicy.reviewEveryUpdate');
    return t('settingsPlugins.updatePolicy.reviewSensitiveChanges');
}

function policySubtitle(policy: PluginUpdatePolicyV1): string {
    if (policy === 'pinned') return t('settingsPlugins.updatePolicy.pinnedSubtitle');
    if (policy === 'reviewEveryUpdate') return t('settingsPlugins.updatePolicy.reviewEveryUpdateSubtitle');
    return t('settingsPlugins.updatePolicy.reviewSensitiveChangesSubtitle');
}

export function PluginUpdatePolicySection(props: Readonly<{
    installed: InstalledPluginEntry;
    targetLabel: Readonly<{ machine: string; server: string }> | null;
    disabled: boolean;
    onSelect: (policy: PluginUpdatePolicyV1) => void;
}>) {
    const { theme } = useUnistyles();
    const current = props.installed.install.updatePolicy;
    const distribution = props.installed.install.trust?.distribution;
    if (!current || !distribution || props.installed.source.kind === 'bundled') return null;

    const policies = distribution.kind === 'npm' ? NPM_POLICIES : OTHER_POLICIES;
    const footer = props.targetLabel
        ? t('settingsPlugins.updatePolicy.target', props.targetLabel)
        : t('common.unavailable');
    return (
        <ItemGroup title={t('settingsPlugins.updatePolicy.title')} footer={footer}>
            {policies.map((policy) => {
                const selected = policy === current;
                return (
                    <Item
                        key={policy}
                        testID={`settings.plugins.detail.${props.installed.pluginId}.updatePolicy.${policy}`}
                        title={policyTitle(policy)}
                        subtitle={policySubtitle(policy)}
                        icon={<Icon
                            name={selected ? 'check-circle' : 'circle'}
                            size={29}
                            color={selected ? theme.colors.accent.indigo : theme.colors.text.secondary}
                        />}
                        selected={selected}
                        onPress={() => props.onSelect(policy)}
                        disabled={props.disabled || selected}
                        showChevron={false}
                    />
                );
            })}
        </ItemGroup>
    );
}
