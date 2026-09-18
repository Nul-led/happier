import * as React from 'react';
import { useNavigation, useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { useHomeAdministrationSettingsAdmission } from '@/hooks/home/useHomeAdministrationSettingsAdmission';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import type { HomeAdministrationHomeEntry } from '@/sync/domains/home/governance/homeAdministrationSettingsAdmission';
import { t } from '@/text';

import { homeAdministrationOverviewPath } from './homeAdministrationRoutes';
import { homeDisplayName, homeUnresolvedReasonLabel } from './homeGovernanceLabels';

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
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const router = useRouter();
    // Home names come from saved profiles, so a renamed Home relabels here too.
    useServerProfilesGeneration();
    const admission = useHomeAdministrationSettingsAdmission();

    React.useEffect(() => {
        navigation.setOptions({ title: t('homeGovernance.title') });
    }, [navigation]);

    const admitted = admission.homes.filter(
        (home): home is Extract<HomeAdministrationHomeEntry, { state: 'admitted' }> => home.state === 'admitted',
    );
    const unresolved = admission.homes.filter(
        (home): home is Extract<HomeAdministrationHomeEntry, { state: 'unresolved' }> => home.state === 'unresolved',
    );

    if (admission.homes.length === 0) {
        return (
            <ItemList>
                <ItemGroup footer={t('homeGovernance.homesEmptyBody')}>
                    <Item
                        testID="home-admin-homes-empty"
                        title={t('homeGovernance.homesEmpty')}
                        mode="info"
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    return (
        <ItemList>
            {admitted.length > 0 ? (
                <ItemGroup title={t('homeGovernance.chooseHome')} footer={t('homeGovernance.chooseHomeFooter')}>
                    {admitted.map((home) => (
                        <Item
                            key={home.serverId}
                            testID={`home-admin-home:${home.serverId}`}
                            title={homeDisplayName(home.serverId)}
                            // An ownerless Home is offered so an administrator can
                            // read its truthful setup state, not to claim it here.
                            subtitle={home.reason === 'owner_setup_required'
                                ? t('homeGovernance.setupRequiredTitle')
                                : undefined}
                            icon={<Icon name="house" size={29} color={theme.colors.accent.blue} />}
                            onPress={() => router.push(homeAdministrationOverviewPath(home.serverId))}
                        />
                    ))}
                </ItemGroup>
            ) : unresolved.length === 0 ? (
                <ItemGroup footer={t('homeGovernance.homesNoneAdministrableBody')}>
                    <Item
                        testID="home-admin-homes-none"
                        title={t('homeGovernance.homesNoneAdministrable')}
                        mode="info"
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}

            {/* Not an answer yet. These stay visible with their reason so a
                partial multi-Home view never reads as a settled refusal. */}
            {unresolved.length > 0 ? (
                <ItemGroup title={t('homeGovernance.homesUnresolved')}>
                    {unresolved.map((home) => (
                        <Item
                            key={home.serverId}
                            testID={`home-admin-home-unresolved:${home.serverId}`}
                            title={homeDisplayName(home.serverId)}
                            subtitle={homeUnresolvedReasonLabel(home.reason)}
                            mode="info"
                            loading={home.reason === 'loading'}
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});
