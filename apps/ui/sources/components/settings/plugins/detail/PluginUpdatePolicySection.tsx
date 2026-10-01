import * as React from 'react';
import type { PluginUpdatePolicyV1 } from '@happier-dev/protocol/marketplace';

import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { t } from '@/text';

import type { InstalledPluginEntry } from '../model/pluginMarketplaceModel';

/**
 * How this installation takes updates on the managed machine: allowed, or pinned until the user
 * chooses again. Bundled plugins ship with Happier and have no policy of their own.
 */
export function PluginUpdatePolicySection(props: Readonly<{
    installed: InstalledPluginEntry;
    targetLabel: Readonly<{ machine: string; server: string }> | null;
    disabled: boolean;
    onSelect: (policy: PluginUpdatePolicyV1) => void;
}>) {
    const current = props.installed.install.updatePolicy;
    const distribution = props.installed.install.trust?.distribution;
    const options = React.useMemo(() => [
        {
            id: 'allowed' as const,
            label: t('settingsPlugins.updatePolicy.allowed'),
            description: t('settingsPlugins.updatePolicy.allowedSubtitle'),
        },
        {
            id: 'pinned' as const,
            label: t('settingsPlugins.updatePolicy.pinned'),
            description: t('settingsPlugins.updatePolicy.pinnedSubtitle'),
        },
    ], []);
    if (!current || !distribution || props.installed.source.kind === 'bundled') return null;

    return (
        <ItemGroup
            title={t('settingsPlugins.surfaces.updatesTitle')}
            description={props.targetLabel
                ? t('settingsPlugins.updatePolicy.target', props.targetLabel)
                : t('common.unavailable')}
        >
            <SegmentedChoiceItem<PluginUpdatePolicyV1>
                testID={`settings.plugins.detail.${props.installed.pluginId}.updatePolicy`}
                testIDPrefix={`settings.plugins.detail.${props.installed.pluginId}.updatePolicy`}
                title={t('settingsPlugins.updatePolicy.title')}
                options={options}
                value={current}
                disabled={props.disabled}
                onChange={(policy) => {
                    if (policy !== current) props.onSelect(policy);
                }}
            />
        </ItemGroup>
    );
}
