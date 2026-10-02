import * as React from 'react';

import { ItemList } from '@/components/ui/lists/ItemList';
import { AcpCatalogSettingsSections } from './AcpCatalogSettingsSections';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';

export const AcpCatalogSettingsScreen = React.memo(function AcpCatalogSettingsScreen() {
    return (
        <ItemList>
            <SettingsPageHeader />
            <AcpCatalogSettingsSections />
        </ItemList>
    );
});
