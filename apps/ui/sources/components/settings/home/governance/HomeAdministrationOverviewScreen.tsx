import * as React from 'react';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

import { HomeAdministrationSection } from './HomeAdministrationSection';
import { homeRoleLabel } from './homeGovernanceLabels';
import {
    homeAdministrationPeoplePath,
    homeAdministrationPoliciesPath,
    homeAdministrationTeamsPath,
} from './homeAdministrationRoutes';

/**
 * The Home Administration entry surface.
 *
 * It answers "which Home am I administering, as whom, and what can I do here"
 * before offering any destination, and it only offers destinations this viewer's
 * projected capabilities actually back.
 */
export const HomeAdministrationOverviewScreen = React.memo(function HomeAdministrationOverviewScreen(
    props: Readonly<{ serverId: string }>,
) {
    const { theme } = useUnistyles();
    const router = useRouter();

    return (
        <HomeAdministrationSection serverId={props.serverId} title={t('homeGovernance.title')}>
            {({ projection, homeName }) => {
                const { capabilities, viewer, teamsEnabled } = projection;
                return (
                    <>
                        <ItemGroup title={homeName || t('homeGovernance.title')}>
                            <Item
                                testID="home-admin-viewer-role"
                                title={t('homeGovernance.yourRole')}
                                detail={homeRoleLabel(viewer.homeRole)}
                                showChevron={false}
                            />
                            <Item
                                testID="home-admin-active-owners"
                                title={t('homeGovernance.activeOwners')}
                                // A count, so it uses the numeric presentation the
                                // list primitive already applies to detail values.
                                detail={String(projection.activeOwnerCount)}
                                showChevron={false}
                            />
                        </ItemGroup>

                        {capabilities.manageAccounts ? (
                            <ItemGroup>
                                <Item
                                    testID="home-admin-people-link"
                                    title={t('homeGovernance.people')}
                                    icon={<Icon name="house" size={29} color={theme.colors.accent.blue} />}
                                    onPress={() => router.push(homeAdministrationPeoplePath(props.serverId))}
                                />
                            </ItemGroup>
                        ) : null}

                        {/* Team administration is governance, not content access,
                            and it is this Home's Teams rather than the viewer's
                            memberships. A Home that has Teams turned off states
                            so instead of offering a destination that could only
                            be empty. */}
                        {capabilities.manageAllTeams ? (
                            <ItemGroup title={t('homeGovernance.teams')}>
                                <Item
                                    testID="home-admin-teams"
                                    title={t('homeGovernance.manageTeams')}
                                    subtitle={teamsEnabled
                                        ? t('homeGovernance.manageTeamsSubtitle')
                                        : t('homeGovernance.teamsDisabled')}
                                    icon={<Icon name="users" size={29} color={theme.colors.accent.blue} />}
                                    mode={teamsEnabled ? 'interactive' : 'info'}
                                    showChevron={teamsEnabled}
                                    {...(teamsEnabled
                                        ? { onPress: () => router.push(homeAdministrationTeamsPath(props.serverId)) }
                                        : {})}
                                />
                            </ItemGroup>
                        ) : null}

                        {capabilities.manageTeamCreationPolicy || capabilities.manageAuthentication ? (
                            <ItemGroup>
                                <Item
                                    testID="home-admin-policies-link"
                                    title={t('homeGovernance.policies')}
                                    icon={<Icon name="shield-check" size={29} color={theme.colors.accent.blue} />}
                                    onPress={() => router.push(homeAdministrationPoliciesPath(props.serverId))}
                                />
                            </ItemGroup>
                        ) : null}
                    </>
                );
            }}
        </HomeAdministrationSection>
    );
});
