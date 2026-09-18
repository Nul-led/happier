import * as React from 'react';
import { Redirect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useIsFocused } from '@react-navigation/native';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { Icon } from '@/components/ui/icons/Icon';
import { SessionsList } from '@/components/sessions/shell/SessionsList';
import { resolveFocusedSessionListSurfaceOwnership } from '@/components/sessions/shell/surface/sessionListSurfaceOwnership';
import {
    resolveTeamSessionsHomeSelection,
    resolveTeamSessionsSurfaceState,
    type SessionListViewContext,
} from '@/components/sessions/shell/search/sessionListViewFilters';
import { teamSessionsPath } from '@/components/settings/teams/teamsRoutes';
import { buildServerSettingsGroupEditorHref } from '@/components/settings/server/navigation/serverSettingsRouteParams';
import { useSessionListSelectionState } from '@/hooks/session/useSessionListSelectionState';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { useTeamBinding } from '@/hooks/teams/useTeamBinding';
import {
    listServerProfiles,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { createTeamAddress, type TeamAddress } from '@/sync/domains/teams/teamAddress';
import { t } from '@/text';

const stylesheet = StyleSheet.create(() => ({
    root: {
        flex: 1,
    },
}));

function firstParam(value: string | string[] | undefined): string {
    return typeof value === 'string' ? value : value?.[0] ?? '';
}

/**
 * The Team's entry into the one canonical Sessions surface.
 *
 * It is a thin deep-link/Back host: rows, filters, pagination, coverage and empty
 * states all belong to `SessionsList`. What this route owns is the qualified
 * context — which Home, which Team — and being honest about the four ways that
 * context can fail to produce a list.
 */
function TeamSessionsSurface(props: Readonly<{ team: TeamAddress }>) {
    const { team } = props;
    const router = useRouter();
    const navigation = useNavigation();
    const selection = useSessionListSelectionState();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const isFocused = useIsFocused();
    // A retained navigation stack keeps this screen mounted behind whatever the
    // person opened next. Off focus it stops taking interaction and stops being a
    // data-active list, so two Team surfaces never run two query lifetimes.
    const surfaceOwnership = resolveFocusedSessionListSurfaceOwnership(isFocused);

    // The exact Home's own decision — never the aggregate over the selection, and
    // never a second evaluator inside the mount helper.
    const listingDecision = useFeatureDecision('sessions.filteredListing', {
        scopeKind: 'spawn',
        serverId: team.serverId,
    });
    const binding = useTeamBinding(team.serverId, team.teamId);
    const loadedTeamName = binding.kind === 'bound' && binding.state.kind === 'ready'
        ? binding.state.team.name.trim() || null
        : null;
    const viewContext = React.useMemo<SessionListViewContext>(
        () => ({ kind: 'team', team, teamDisplayName: loadedTeamName }),
        [loadedTeamName, team],
    );
    const mountedHomeServerIds = selection.allowedServerIds?.length
        ? selection.allowedServerIds
        : selection.activeServerId
            ? [selection.activeServerId]
            : [];
    const surfaceState = resolveTeamSessionsSurfaceState({
        decision: listingDecision,
        homeSelection: resolveTeamSessionsHomeSelection({
            team,
            mountedHomeServerIds,
            focusedHomeServerId: selection.activeServerId,
        }),
    });

    // The Team's own name is the label people recognize. The immutable id is a
    // truthful stand-in only while the Home has not answered yet; it is never the
    // steady-state copy and never a second identity.
    const teamName = loadedTeamName ?? team.teamId;
    React.useLayoutEffect(() => {
        if (!loadedTeamName) return;
        navigation.setOptions({ headerTitle: loadedTeamName });
    }, [loadedTeamName, navigation]);

    if (surfaceState.kind === 'loading') {
        return (
            <View style={styles.root} testID="team-sessions-listing-loading">
                <EmptyState
                    icon={<Icon name="hourglass" size={48} color={theme.colors.text.secondary} />}
                    title={t('sessionsList.teamListingLoadingTitle', { team: teamName })}
                    subtitle={t('sessionsList.teamListingLoadingDescription')}
                />
            </View>
        );
    }

    if (surfaceState.kind === 'probe_failed') {
        return (
            <View style={styles.root} testID="team-sessions-listing-probe-failed">
                <EmptyState
                    icon={<Icon name="cloud-slash" size={48} color={theme.colors.text.secondary} />}
                    title={t('sessionsList.teamListingProbeFailedTitle')}
                    subtitle={t('sessionsList.teamListingProbeFailedDescription')}
                    action={(
                        <RoundButton
                            testID="team-sessions-probe-retry"
                            size="normal"
                            title={t('common.retry')}
                            accessibilityLabel={t('common.retry')}
                            onPress={() => {
                                // Retry the canonical exact-Home feature probe. A Team-detail
                                // refresh cannot change this decision and would leave the
                                // probe-failed state stuck behind the wrong recovery action.
                                void getServerFeaturesSnapshot({
                                    serverId: team.serverId,
                                    force: true,
                                });
                            }}
                        />
                    )}
                />
            </View>
        );
    }

    if (surfaceState.kind === 'unavailable') {
        return (
            <View style={styles.root} testID="team-sessions-listing-unavailable">
                <EmptyState
                    icon={<Icon name="warning-circle" size={48} color={theme.colors.text.secondary} />}
                    title={t('sessionsList.teamListingUnavailableTitle')}
                    subtitle={t('sessionsList.teamListingUnavailableDescription')}
                />
            </View>
        );
    }

    if (surfaceState.kind === 'home_not_mounted') {
        const home = listServerProfiles().find((profile) => (
            resolveServerProfileScopeId(profile) === team.serverId
            || profile.id === team.serverId
        ));
        const homeLabel = home?.name?.trim() || team.serverId;
        const initialGroupServerIds = surfaceState.initialGroupServerIds;
        return (
            <View style={styles.root} testID="team-sessions-home-not-mounted">
                <EmptyState
                    icon={<Icon name="hard-drives" size={48} color={theme.colors.text.secondary} />}
                    title={t('sessionsList.partialHomeNotMountedTitle', { home: homeLabel })}
                    subtitle={t('sessionsList.partialHomeNotMountedDescription')}
                    action={(
                        <RoundButton
                            testID="team-sessions-show-from-home"
                            size="normal"
                            title={t('sessionsList.partialShowFromHome', { home: homeLabel })}
                            accessibilityLabel={t('sessionsList.partialShowFromHome', { home: homeLabel })}
                            onPress={() => router.push(buildServerSettingsGroupEditorHref({
                                initialGroupServerIds,
                            }) as never)}
                        />
                    )}
                />
            </View>
        );
    }

    return (
        <View style={styles.root} testID="team-sessions-screen">
            <SessionsList
                // The Home travels in the path, so two Homes holding the same Team
                // id keep distinct surface identity, retention and Back behaviour.
                pathname={teamSessionsPath(team)}
                releaseRetentionOnRouteRemoval
                viewContext={viewContext}
                surfaceOwnership={surfaceOwnership}
            />
        </View>
    );
}

export default function TeamSessionsRoute() {
    const params = useLocalSearchParams<{
        teamId?: string | string[];
        serverId?: string | string[];
    }>();
    const team = createTeamAddress(firstParam(params.serverId), firstParam(params.teamId));

    if (!team) return <Redirect href="/" />;

    return <TeamSessionsSurface team={team} />;
}
