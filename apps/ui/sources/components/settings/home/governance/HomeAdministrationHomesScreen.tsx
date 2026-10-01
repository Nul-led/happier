import * as React from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from '@/components/appShell/workspace/destinationRoute';

import { EmptyState } from '@/components/ui/empty/EmptyState';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemLoadStateRows } from '@/components/ui/lists/ItemLoadStateRows';
import { useHomeAdministrationSettingsAdmission } from '@/hooks/home/useHomeAdministrationSettingsAdmission';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import type { HomeAdministrationHomeEntry } from '@/sync/domains/home/governance/homeAdministrationSettingsAdmission';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { HOME_ADMINISTRATION_SETTINGS_ENTRY, homeAdministrationOverviewPath } from './homeAdministrationRoutes';
import { homeDisplayName, homeUnresolvedReasonLabel } from './homeGovernanceLabels';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { Icon } from '@/components/ui/icons/Icon';

/**
 * Which Home to administer.
 *
 * Every Home answers for itself: administering one says nothing about another,
 * so this asks each Home in the exact set separately and offers only the ones
 * that admitted this device's account there. Homes that have not answered are
 * listed with the reason rather than hidden, because "you are signed out of
 * this Home" and "you may not administer it" are different facts and only one
 * of them is something the person can act on.
 */
export const HomeAdministrationHomesScreen = React.memo(function HomeAdministrationHomesScreen() {
    const navigation = useNavigation();
    const router = useRouter();
    // Home names come from saved profiles, so a renamed Home relabels here too.
    useServerProfilesGeneration();
    const admission = useHomeAdministrationSettingsAdmission();
    const { entry } = useLocalSearchParams<{ entry?: string }>();
    const enteredFromSettings = entry === HOME_ADMINISTRATION_SETTINGS_ENTRY;

    React.useEffect(() => {
        navigation.setOptions({ title: t('homeGovernance.title') });
    }, [navigation]);

    const admitted = admission.homes.filter(
        (home): home is Extract<HomeAdministrationHomeEntry, { state: 'admitted' }> => home.state === 'admitted',
    );
    const unresolved = admission.homes.filter(
        (home): home is Extract<HomeAdministrationHomeEntry, { state: 'unresolved' }> => home.state === 'unresolved',
    );
    // Entered from the Settings navigation with exactly one Home to administer, there is nothing to
    // choose: its console opens in place of a one-entry list. The list itself (All Homes, a link to
    // it, back) always shows. A Home still being read, or not answering, may be administrable too, so
    // the list stays until every Home has answered.
    const pending = unresolved.some((home) => home.reason === 'loading' || home.reason === 'unreachable');
    const onlyHomeId = enteredFromSettings && admitted.length === 1 && !pending ? admitted[0]!.serverId : null;
    React.useEffect(() => {
        if (!onlyHomeId) return;
        const result = runGuardedNavigation(() => router.replace(homeAdministrationOverviewPath(onlyHomeId) as never));
        if (result !== true) fireAndForget(result, { tag: 'HomeAdministrationHomesScreen.onlyHome' });
    }, [onlyHomeId, router]);
    if (onlyHomeId) {
        return (
            <ItemList presentation="page" testID="home-admin-homes-opening">
                <SettingsPageHeader description={t('homeGovernance.pages.homes')} />
            </ItemList>
        );
    }

    if (admission.homes.length === 0) {
        return (
            <ItemList presentation="page">
                <SettingsPageHeader description={t('homeGovernance.pages.homes')} />
                <EmptyState
                    testID="home-admin-homes-empty"
                    layout="page"
                    iconName="house"
                    title={t('homeGovernance.homesEmpty')}
                    subtitle={t('homeGovernance.homesEmptyBody')}
                />
            </ItemList>
        );
    }

    const nothingAdministrable = admitted.length === 0 && unresolved.length === 0;
    return (
        <ItemList presentation="page">
            <SettingsPageHeader description={t('homeGovernance.pages.homes')} />
            {nothingAdministrable ? (
                <ItemGroup>
                    <Item
                        testID="home-admin-homes-none"
                        title={t('homeGovernance.homesNoneAdministrable')}
                        subtitle={t('homeGovernance.homesNoneAdministrableBody')}
                        subtitleLines={0}
                        mode="info"
                        showChevron={false}
                    />
                </ItemGroup>
            ) : (
                // One section: a Home that has not answered is one of the Homes, in exactly one state
                // (being read, not answering with Retry, or why it cannot be offered), never under a
                // second heading that contradicts its row.
                <ItemGroup title={t('homeGovernance.chooseHome')} description={t('homeGovernance.chooseHomeFooter')}>
                    {admitted.map((home) => (
                        <Item
                            key={home.serverId}
                            testID={`home-admin-home:${home.serverId}`}
                            icon={<Icon name="house" />}
                            title={homeDisplayName(home.serverId)}
                            // An ownerless Home is offered so an administrator can
                            // read its truthful setup state, not to claim it here.
                            subtitle={home.reason === 'owner_setup_required'
                                ? t('homeGovernance.setupRequiredTitle')
                                : undefined}
                            onPress={() => router.push(homeAdministrationOverviewPath(home.serverId))}
                        />
                    ))}
                    {unresolved.map((home) => (home.reason === 'loading' || home.reason === 'unreachable' ? (
                        <ItemLoadStateRows
                            key={home.serverId}
                            testID={`home-admin-home-unresolved:${home.serverId}`}
                            state={home.reason === 'loading'
                                ? { kind: 'loading' }
                                : {
                                    kind: 'failed',
                                    reason: t('homeGovernance.homeNotAnswering', { home: homeDisplayName(home.serverId) }),
                                    onRetry: () => admission.retry(home.serverId),
                                }}
                            rows={1}
                            lines={1}
                            accessibilityLabel={homeDisplayName(home.serverId)}
                        />
                    ) : (
                        <Item
                            key={home.serverId}
                            testID={`home-admin-home-unresolved:${home.serverId}`}
                            title={homeDisplayName(home.serverId)}
                            subtitle={homeUnresolvedReasonLabel(home.reason)}
                            mode="info"
                            showChevron={false}
                        />
                    )))}
                </ItemGroup>
            )}
        </ItemList>
    );
});
