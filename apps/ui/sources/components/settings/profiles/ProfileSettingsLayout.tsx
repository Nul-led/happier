import * as React from 'react';
import { Stack } from '@/components/appShell/workspace/destinationRoute';

import { getSettingsStackScreenDefinitions } from '@/components/settings/navigation/settingsRouteRegistry';
import { SettingsCollectionLayout } from '@/components/settings/shell/SettingsCollectionLayout';
import { useSetting } from '@/sync/domains/state/storage';
import { getPreferredLanguage, t } from '@/text';

import { ProfileCollectionRail } from './ProfileCollectionList';
import { PROFILES_COLLECTION_ROOT, resolveProfilesChildRoute } from './profileCollectionRoutes';

/** Rail width at normal text scale: a compatibility mark, a profile name and one summary line. */
const PROFILE_RAIL_WIDTH_PX = 272;
/** The narrowest detail that still fits an environment variable row beside its label. */
const PROFILE_DETAIL_MIN_WIDTH_PX = 480;

/**
 * Profiles as a collection beside the selected profile's editor. Narrow: the list page pushes each
 * profile. With profiles turned off the page is only the switch that turns them on, so no rail shows.
 */
export const ProfileSettingsLayout = React.memo(function ProfileSettingsLayout() {
    const useProfiles = useSetting('useProfiles');
    if (!useProfiles) return <ProfilesStack />;
    return (
        <SettingsCollectionLayout
            navigator="profiles"
            rootPathname={PROFILES_COLLECTION_ROOT}
            resolveChildRoute={resolveProfilesChildRoute}
            rail={<ProfileCollectionRail />}
            railWidthPx={PROFILE_RAIL_WIDTH_PX}
            detailMinWidthPx={PROFILE_DETAIL_MIN_WIDTH_PX}
            testID="settings-profiles"
        />
    );
});

/** The collection's screens without a rail. */
const ProfilesStack = React.memo(function ProfilesStack() {
    const preferredLanguage = getPreferredLanguage();
    const routes = React.useMemo(
        () => getSettingsStackScreenDefinitions(t, { navigator: 'profiles', isModalPresentation: true }),
        [preferredLanguage],
    );
    return (
        <Stack screenOptions={{ headerShown: false }}>
            {routes.map((route) => <Stack.Screen key={route.name} name={route.name} />)}
        </Stack>
    );
});
