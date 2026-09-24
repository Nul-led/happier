import * as React from 'react';
import { useNavigation, useRouter } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { useActionApprovalContinuation } from '@/components/approvals/useActionApprovalContinuation';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { HomeCredentialUnreadableCard } from '@/components/sessions/access/UnboundSessionHomeScopeCard';
import { Text } from '@/components/ui/text/Text';
import { useTeamBinding } from '@/hooks/teams/useTeamBinding';
import { serverAccountScopedTeamKey } from '@/sync/domains/teams/teamAddress';
import { presentTeamEntryUnavailableReason } from '@/components/teams/entry/teamAuthenticationFailure';
import { teamSignInReturnPath } from '@/components/teams/entry/teamSignInHome';
import { t } from '@/text';

import type { TeamSectionContext } from './teamSectionContext';

const styles = StyleSheet.create((theme) => ({
    centered: {
        paddingVertical: 48,
        paddingHorizontal: 24,
        alignItems: 'center',
        gap: 12,
    },
    centeredTitle: {
        color: theme.colors.text.primary,
        textAlign: 'center',
    },
    centeredBody: {
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
}));

const TeamMessage = React.memo(function TeamMessage(props: Readonly<{
    title: string;
    body?: string;
    busy?: boolean;
    testID?: string;
}>) {
    return (
        <View
            style={styles.centered}
            testID={props.testID}
            accessible
            accessibilityRole={props.busy ? 'progressbar' : 'alert'}
            accessibilityLabel={[props.title, props.body].filter(Boolean).join('. ')}
            accessibilityLiveRegion={props.busy ? 'polite' : 'assertive'}
        >
            {props.busy ? <ActivitySpinner /> : null}
            <Text style={styles.centeredTitle}>{props.title}</Text>
            {props.body ? <Text style={styles.centeredBody}>{props.body}</Text> : null}
        </View>
    );
});

/**
 * The one place a Team destination decides how its Team's condition is shown.
 *
 * Overview, Members, Groups, Invitations and Settings all render through this,
 * so the freshness notice, the offline explanation, the archived read-only
 * notice and the retry cannot drift between them. Sections receive the Team only
 * once it exists, so no section defends itself against a Home that has not
 * answered — and none of them re-derives whether a write may be offered.
 */
export const TeamSection = React.memo(function TeamSection(props: Readonly<{
    serverId: string;
    teamId: string;
    /** Falls back to the Team's own name once the Home has answered. */
    title?: string;
    presentation?: 'item-list' | 'virtualized-list';
    children: (context: TeamSectionContext, header?: React.ReactNode) => React.ReactNode;
}>) {
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const router = useRouter();
    const binding = useTeamBinding(props.serverId, props.teamId);
    const scopeKey = binding.kind === 'bound'
        ? serverAccountScopedTeamKey(binding.scope, binding.address)
        : `unbound:${props.serverId}:${props.teamId}`;
    const approvalRefresh = React.useCallback(() => {
        if (binding.kind === 'bound') binding.refresh();
    }, [binding]);
    const {
        approvalId,
        approvalStatus,
        approvalPending,
        isLoading: approvalLoading,
        error: approvalError,
        requestApproval,
    } = useActionApprovalContinuation({
        scopeKey,
        serverId: props.serverId,
        onExecuted: approvalRefresh,
    });

    const resolvedTitle = props.title
        ?? (binding.kind === 'bound' && binding.state.kind === 'ready' ? binding.state.team.name : t('teams.title'));

    React.useEffect(() => {
        navigation.setOptions({ title: resolvedTitle });
    }, [navigation, resolvedTitle]);

    if (binding.kind === 'resolving') {
        return <TeamMessage title={t('teams.title')} busy testID="team-resolving" />;
    }

    if (binding.kind === 'invalid_address' || binding.kind === 'unknown_home') {
        return (
            <TeamMessage
                title={t('teams.errors.notFound')}
                testID="team-unknown-home"
            />
        );
    }

    if (binding.kind === 'signed_out') {
        return (
            <TeamMessage
                title={t('homeGovernance.forbiddenTitle')}
                body={t('homeGovernance.forbiddenBody')}
                testID="team-signed-out"
            />
        );
    }

    if (binding.kind === 'credential_unreadable') {
        return (
            <ItemList>
                <HomeCredentialUnreadableCard serverId={binding.serverId} testID="team-credential-unreadable" />
            </ItemList>
        );
    }

    const { state, homeName, address, refresh } = binding;

    if (state.kind === 'unobserved' || state.kind === 'loading') {
        return <TeamMessage title={t('teams.title')} busy testID="team-loading" />;
    }

    if (state.kind === 'unavailable' && state.error.code === 'team_authentication_required') {
        // The Home recognised this member but the current sign-in does not
        // satisfy this Team's authentication. The recovery is the canonical
        // exact-Home Team entry for this route's own Home (L03/02 §8.2), never a
        // generic denial and never an automatic retry of the refused read.
        const presentation = presentTeamEntryUnavailableReason('sso_required');
        return (
            <ItemList>
                <TeamMessage
                    title={presentation?.title ?? t('homeGovernance.forbiddenTitle')}
                    body={presentation?.body}
                    testID="team-authentication-required"
                />
                <ItemGroup>
                    <Item
                        testID="team-sign-in"
                        title={t('teams.entry.signInToTeam')}
                        icon={<Icon name="sign-in" size={29} color={theme.colors.text.secondary} />}
                        onPress={() => router.push(teamSignInReturnPath({
                            teamId: props.teamId,
                            serverId: props.serverId,
                        }))}
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    if (state.kind === 'unavailable') {
        // `forbidden`/`unauthorized` are the Home's settled answers about this
        // Account and `unsupported` is its settled answer about itself. None of
        // them is offered a retry that would ask the same question again.
        const denied = state.error.kind === 'forbidden' || state.error.kind === 'unauthorized';
        const unsupported = state.error.kind === 'unsupported';
        return (
            <ItemList>
                <TeamMessage
                    title={denied ? t('homeGovernance.forbiddenTitle') : t('teams.unavailable.title')}
                    body={denied
                        ? t('teams.errors.forbidden')
                        : unsupported
                            ? t('teams.unavailable.updateRequired')
                            : t('teams.unavailable.offline')}
                    testID="team-unavailable"
                />
                {state.retryable ? (
                    <ItemGroup>
                        <Item
                            testID="team-retry"
                            title={t('teams.unavailable.retry')}
                            icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                            onPress={refresh}
                            showChevron={false}
                        />
                    </ItemGroup>
                ) : null}
            </ItemList>
        );
    }

    const context: TeamSectionContext = {
        scope: state.scope,
        address,
        homeName,
        team: state.team,
        // An archived Team is read-only for everyone; restore stays available to
        // the viewers whose projected capability actually backs it.
        mutationsAvailable: state.mutationsAvailable,
        archived: state.archived,
        canMutate: state.mutationsAvailable && !state.archived && !approvalPending,
        approvalPending,
        refresh,
        requestApproval,
    };

    const header = (
        <>
            {approvalId ? (
                <ItemGroup>
                    <Item
                        testID="team-approval"
                        title={t('approvals.title')}
                        subtitle={approvalError
                            ? t('approvals.loadError')
                            : approvalLoading || approvalStatus === 'open' || approvalStatus === 'approved' || approvalStatus === 'executing'
                                ? t('approvals.status.open')
                                : t('approvals.details')}
                        accessibilityLiveRegion={approvalError ? 'assertive' : 'polite'}
                        onPress={() => router.push(`/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(props.serverId)}`)}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            {state.stale ? (
                <ItemGroup footer={t('teams.stale.label')}>
                    <Item
                        testID="team-stale"
                        title={state.error ? t('teams.unavailable.offline') : t('teams.stale.label')}
                        icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                        detail={t('teams.unavailable.retry')}
                        accessibilityLiveRegion="polite"
                        onPress={refresh}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}

            {state.archived ? (
                <ItemGroup footer={t('teams.archive.readOnly')}>
                    <Item
                        testID="team-archived"
                        title={t('teams.directory.archivedBadge')}
                        subtitle={t('teams.archive.readOnly')}
                        icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}

        </>
    );

    if (props.presentation === 'virtualized-list') {
        return (
            <React.Fragment key={scopeKey}>
                {props.children(context, header)}
            </React.Fragment>
        );
    }

    return (
        <ItemList>
            {header}

            <React.Fragment key={scopeKey}>
                {props.children(context)}
            </React.Fragment>
        </ItemList>
    );
});
