import * as React from 'react';

import type { SettingsBelowFoldSectionsProps } from '@/components/settings/settingsBelowFoldSectionTypes';
import { Item } from '@/components/ui/lists/Item';
import { Icon } from '@/components/ui/icons/Icon';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

type SettingsDeveloperSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'devModeEnabled'
    | 'router'
>>;

export const SettingsDeveloperSection = React.memo(function SettingsDeveloperSection({
    devModeEnabled,
    router,
}: SettingsDeveloperSectionProps) {
    if (!__DEV__ && !devModeEnabled) return null;

    return (
        <ItemGroup title={t('settings.developer')}>
            <Item
                title={t('settings.developerTools')}
                icon={<Icon name="wrench" />}
                onPress={() => router.push('/(app)/dev')}
            />
        </ItemGroup>
    );
});
