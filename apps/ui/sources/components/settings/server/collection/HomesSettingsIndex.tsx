import * as React from 'react';
import { Redirect } from '@/components/appShell/workspace/destinationRoute';
import { useHappierCollectionIndexView } from '@happier-dev/plugin-ui/presentation';

import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { ItemList } from '@/components/ui/lists/ItemList';
import { t } from '@/text';

import { HomesCollectionList, HomesCollectionProvider } from './HomesCollection';
import { HOMES_DEVICE_ROUTE } from './homeCollectionModel';

/**
 * `/settings/server`. Beside the rail something is always selected, so the index lands on this
 * device's page (how it reaches its Homes); where no rail shows, the index is the list and each row
 * pushes its page.
 */
export const HomesSettingsIndex = React.memo(function HomesSettingsIndex() {
    const view = useHappierCollectionIndexView();
    if (view === 'pending') return null;
    if (view === 'land') return <Redirect href={HOMES_DEVICE_ROUTE as never} />;
    return <HomesSettingsListPage />;
});

/** The Homes list as a page: where no rail shows, and the onboarding stage's Homes surface. */
export const HomesSettingsListPage = React.memo(function HomesSettingsListPage() {
    return (
        <ItemList>
            <SettingsPageHeader description={t('server.page.description')} />
            <HomesCollectionList variant="page" />
        </ItemList>
    );
});

/** The Homes list with its own data owner, for the onboarding stage (outside the Settings layout). */
export const HomesSettingsStageSurface = React.memo(function HomesSettingsStageSurface() {
    return (
        <HomesCollectionProvider>
            <HomesSettingsListPage />
        </HomesCollectionProvider>
    );
});
