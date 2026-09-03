import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import type { MemorySettingsV1, MemoryStatusV1 } from '@happier-dev/protocol';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Switch } from '@/components/ui/forms/Switch';
import { resolveArchivedMemoryEligibilityControl } from '@/sync/domains/memory/resolveArchivedMemoryEligibilityControl';
import { t } from '@/text';

/**
 * Opt-in archived eligibility for daemon-local memory.
 *
 * The control is enabled only when the daemon advertises that it implements
 * the setting, and it shows the eligibility the daemon actually applies. An
 * older daemon echoes the stored setting while ignoring it, so this surface
 * says "update needed" rather than pretending the change took effect.
 */
export const MemorySettingsArchivedSection = React.memo(function MemorySettingsArchivedSection(props: Readonly<{
    settings: MemorySettingsV1;
    status: MemoryStatusV1 | null;
    writeSettings: (next: MemorySettingsV1) => void | Promise<void>;
}>) {
    const { theme } = useUnistyles();
    const control = resolveArchivedMemoryEligibilityControl({
        status: props.status,
        desiredIncludeArchivedSessions: props.settings.includeArchivedSessions,
    });

    return (
        <ItemGroup
            title={t('memorySearchSettings.archived.groupTitle')}
            footer={control.supported
                ? t('memorySearchSettings.archived.groupFooter')
                : t('memorySearchSettings.archived.unsupportedFooter')}
        >
            <Item
                testID="memory-settings-include-archived-item"
                title={t('memorySearchSettings.archived.includeTitle')}
                subtitle={control.supported
                    ? t('memorySearchSettings.archived.includeSubtitle')
                    : t('memorySearchSettings.archived.unsupportedSubtitle')}
                icon={<Icon name="archive" size={29} color={theme.colors.accent.purple} />}
                rightElement={(
                    <Switch
                        testID="memory-settings-include-archived"
                        value={control.value}
                        disabled={!control.supported}
                        onValueChange={(value) => {
                            if (!control.supported) return;
                            void props.writeSettings({
                                ...props.settings,
                                includeArchivedSessions: Boolean(value),
                            });
                        }}
                    />
                )}
                showChevron={false}
            />
        </ItemGroup>
    );
});
