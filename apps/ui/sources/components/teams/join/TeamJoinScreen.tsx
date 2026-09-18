import * as React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { TeamInvitationTokenV1Schema, type TeamInvitationPostAuthContinuationV1 } from '@happier-dev/protocol/teams';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { t } from '@/text';

import {
    isTeamInvitationTargetBindingValidBeforeResolution,
    usePortableHomeLinkTarget,
} from './teamJoinTarget';
import { TeamAuthEntrySurface } from '@/components/teams/entry/TeamAuthEntrySurface';
import type { TeamAuthEntrySelection } from '@/components/teams/entry/TeamAuthEntrySurface';
import { projectTeamAuthSelection } from '@/components/teams/entry/teamAuthAction';
import { teamSignInReturnPath } from '@/components/teams/entry/teamSignInHome';
import { HomeAuthenticationFlow } from '@/components/account/auth/HomeAuthenticationFlow';
import { useExactHomeDestination } from '@/components/account/auth/useExactHomeDestination';
import { getCurrentAuth } from '@/auth/context/AuthContext';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { teamDetailPath } from '@/components/settings/teams/teamsRoutes';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { resolveTeamJoinPresentation } from './teamJoinOutcome';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

function TeamJoinTerminalState(props: React.PropsWithChildren) {
    return (
        <View
            accessibilityLiveRegion="polite"
            aria-live="polite"
            role="status"
        >
            {props.children}
        </View>
    );
}

/**
 * Accepting a Team invitation.
 *
 * The bearer arrives in the route path and may only ever be sent to the Home the
 * link itself named. Child 05 §8 forbids substituting a chooser, the focused
 * Home, or the application origin when that Home cannot be resolved, because
 * previewing a bearer against a Home is what tells that Home the secret.
 */
export const TeamJoinScreen = React.memo(function TeamJoinScreen(props: Readonly<{
    /** The link's non-secret portable Home carrier, passed through unread by the route. */
    homeTarget?: string | null;
}> & (
    | Readonly<{
        token: string;
        targetBinding?: string | null;
        postAuthContinuation?: never;
    }>
    | Readonly<{ token?: never; postAuthContinuation: TeamInvitationPostAuthContinuationV1 }>
)) {
    const navigation = useNavigation();
    const router = useRouter();
    /**
     * `/join/<token>` is a cold-start deep link more often than not, so there
     * is frequently nothing behind it. Every exit goes through the one safe
     * back owner, which falls back to the root instead of a no-op `back`.
     */
    const exit = React.useCallback(() => {
        safeRouterBack({ router, navigation, fallbackHref: '/' });
    }, [navigation, router]);
    const [selection, setSelection] = React.useState<TeamAuthEntrySelection | null>(null);
    /**
     * Before an email-bound invitation mutates anything, the person may choose
     * to use another Account on the same Home. The screen then stops presenting
     * the current Account's scope and asks that Home for authentication methods
     * again. Nothing is signed out and the focused Home is untouched, so their
     * existing access elsewhere survives a cancelled recovery.
     */
    const [recoveringIdentity, setRecoveringIdentity] = React.useState(false);
    const [completedAdmission, setCompletedAdmission] = React.useState<Readonly<{
        outcome: 'joined';
        teamId: string;
        teamName: string;
    }> | null>(null);
    const useCurrentAccount = React.useCallback(() => {
        setSelection(null);
        setRecoveringIdentity(false);
    }, []);
    /**
     * Admission committed on the Home the link named, which is not necessarily the
     * Home this device is focused on. Opening the Team before that focus moves
     * would render the previously focused Home's Teams route and read as the join
     * having done nothing. This is the same arrival every committed capability
     * link uses, so it keeps its one focus/blocked/retry owner; retry re-runs only
     * the focus and this exact Team route — never the admission.
     *
     * The Account refresh is read through the canonical non-React accessor: a
     * capability route mounts this screen directly and it owns no Account state of
     * its own, exactly as the Personal Home bootstrap runtime does.
     */
    const destination = useExactHomeDestination({
        refreshAuth: React.useCallback(async () => {
            await getCurrentAuth()?.refreshFromActiveServer();
        }, []),
    });
    const openTeamOnExactHome = React.useCallback(async (
        serverId: string,
        teamId: string,
    ): Promise<void> => {
        await destination.continueToHome(serverId, () => {
            router.replace(teamDetailPath({
                serverId: resolveServerProfileScopeIdForIdentifier(serverId),
                teamId,
            }));
        });
    }, [destination.continueToHome, router]);

    React.useEffect(() => {
        navigation?.setOptions?.({ title: t('teams.title') });
    }, [navigation]);

    const tokenParse = TeamInvitationTokenV1Schema.safeParse(props.token);
    const targetBinding = 'targetBinding' in props ? props.targetBinding : null;
    const targetBindingValid = React.useMemo(() => (
        props.postAuthContinuation
            ? true
            : isTeamInvitationTargetBindingValidBeforeResolution({
                token: props.token,
                carrier: props.homeTarget,
                binding: targetBinding,
            })
    ), [props.homeTarget, props.postAuthContinuation, props.token, targetBinding]);
    // Credential resolution updates this screen asynchronously. The link owner
    // keeps the resolved Home stable so nested exact-Home requests are not
    // retired merely because that credential state caused a parent render. A
    // current link for an unsaved Home acquires it here, in place, so this
    // mounted invitation and its in-memory bearer simply carry on.
    const target = usePortableHomeLinkTarget(targetBindingValid ? props.homeTarget : null);
    const scopeResolution = useServerCredentialAccountScopeResolution(
        target.kind === 'resolved' ? target.serverId : null,
    );

    if ((!tokenParse.success || !targetBindingValid) && !props.postAuthContinuation) {
        return (
            <TeamJoinTerminalState>
                <ItemList>
                    <ItemGroup footer={t('teams.join.askForNew')}>
                        <Item testID="team-join-invalid" title={t('teams.join.invalidTitle')} showChevron={false} />
                        <Item testID="team-join-back" title={t('common.back')} onPress={exit} />
                    </ItemGroup>
                </ItemList>
            </TeamJoinTerminalState>
        );
    }

    // Two different unusable-target states with two different remedies. An
    // unresolvable or ambiguous carrier is terminal for this device — asking a
    // Home would be a guess about where the secret goes. A Home this device has
    // simply not adopted is ordinary on a first device, and the existing Homes
    // acquisition flow is the real next step; the invitation stays valid while
    // the person completes it, so reopening this link afterwards continues here.
    if (target.kind === 'unresolved' || target.kind === 'ambiguous') {
        return (
            <TeamJoinTerminalState>
              <ItemList>
                <ItemGroup footer={t('teams.join.unresolvedHomeBody')}>
                    <Item
                        testID={target.kind === 'ambiguous'
                            ? 'team-join-ambiguous-home'
                            : 'team-join-unresolved-home'}
                        title={t('teams.join.unresolvedHomeTitle')}
                        subtitle={t('teams.join.askForNew')}
                        showChevron={false}
                    />
                    <Item testID="team-join-back" title={t('common.back')} onPress={exit} />
                </ItemGroup>
              </ItemList>
            </TeamJoinTerminalState>
        );
    }

    // A current link carries the Home's own descriptor, so the first device can
    // acquire it without leaving this invitation. Nothing is asked of any Home
    // until that acquisition has proven the descriptor's stable identity.
    if (target.kind === 'acquiring') {
        return (
            <SurfaceStateCard
                testID="team-join-acquiring-home"
                kind="loading"
                title={t('common.loading')}
                accessibilitySemantics="status"
            />
        );
    }

    if (target.kind === 'acquisition_failed') {
        return (
            <TeamJoinTerminalState>
              <ItemList>
                <ItemGroup footer={t('server.notificationAddServerHint')}>
                    <Item
                        testID="team-join-unreachable-home"
                        title={t('teams.join.unknownHomeTitle')}
                        showChevron={false}
                    />
                    <Item testID="team-join-retry-home" title={t('common.retry')} onPress={target.retry} />
                    <Item
                        testID="team-join-add-home"
                        title={t('server.addServerTitle')}
                        onPress={() => router.push('/server')}
                    />
                    <Item testID="team-join-back" title={t('common.back')} onPress={exit} />
                </ItemGroup>
              </ItemList>
            </TeamJoinTerminalState>
        );
    }

    if (target.kind === 'unknown_home') {
        return (
            <TeamJoinTerminalState>
              <ItemList>
                <ItemGroup footer={t('server.notificationAddServerHint')}>
                    <Item
                        testID="team-join-unknown-home"
                        title={t('teams.join.unknownHomeTitle')}
                        showChevron={false}
                    />
                    <Item
                        testID="team-join-add-home"
                        title={t('server.addServerTitle')}
                        onPress={() => router.push('/server')}
                    />
                    <Item testID="team-join-back" title={t('common.back')} onPress={exit} />
                </ItemGroup>
              </ItemList>
            </TeamJoinTerminalState>
        );
    }

    if (scopeResolution.kind === 'unknown_home') {
        return (
            <TeamJoinTerminalState>
              <ItemList>
                <ItemGroup footer={t('server.notificationAddServerHint')}>
                    <Item testID="team-join-unknown-home" title={t('teams.join.unknownHomeTitle')} showChevron={false} />
                    <Item testID="team-join-add-home" title={t('server.addServerTitle')} onPress={() => router.push('/server')} />
                    <Item testID="team-join-back" title={t('common.back')} onPress={exit} />
                </ItemGroup>
              </ItemList>
            </TeamJoinTerminalState>
        );
    }

    if (scopeResolution.kind === 'resolving') {
        return <SurfaceStateCard testID="team-join-resolving-account" kind="loading" title={t('common.loading')} accessibilitySemantics="status" />;
    }

    // Membership is already committed; only reaching its Home is left. A device
    // that cannot get there keeps a visible retry instead of being dropped onto
    // whichever Home it was looking at before.
    if (destination.state.kind !== 'idle') {
        const destinationState = destination.state;
        return destinationState.kind === 'focusing'
            ? (
                <SurfaceStateCard
                    testID="team-join-destination-home"
                    kind="loading"
                    title={t('common.loading')}
                    accessibilitySemantics="status"
                />
            )
            : (
                <SurfaceStateCard
                    testID="team-join-destination-home"
                    kind="unavailable"
                    title={t('teams.join.offlineTitle')}
                    reason={t('settingsAccount.nativePassword.serverUnavailable')}
                    action={{ label: t('common.retry'), onPress: destinationState.retry }}
                    secondaryAction={{ label: t('common.back'), onPress: exit }}
                    accessibilitySemantics="alert"
                />
            );
    }

    if (completedAdmission) {
        return (
            <SurfaceStateCard
                testID="team-auth-entry-admission-complete"
                kind="empty"
                title={resolveTeamJoinPresentation(completedAdmission).title}
                action={{
                    label: t('teams.join.openTeam', { team: completedAdmission.teamName }),
                    onPress: () => openTeamOnExactHome(target.serverId, completedAdmission.teamId),
                }}
                accessibilitySemantics="status"
            />
        );
    }

    const selected = selection ? projectTeamAuthSelection(selection) : null;
    const matchingScope = !recoveringIdentity && scopeResolution.kind === 'bound'
        ? scopeResolution.scope
        : null;
    if (props.postAuthContinuation && !matchingScope) {
        return (
            <SurfaceStateCard
                testID="team-join-post-auth-account-unavailable"
                kind="unavailable"
                title={t('teams.join.inactiveTitle')}
                reason={t('teams.join.askForNew')}
                action={{ label: t('common.back'), onPress: exit }}
                accessibilitySemantics="status"
            />
        );
    }
    if (selection && selected && !matchingScope && tokenParse.success) {
        // Generic OAuth/mTLS pending custody must never retain the invitation
        // bearer. Recovery lands on the exact Team/Home entry; without a valid
        // server-held purpose-bound continuation, admission fails closed.
        // The Team sign-in return URL has one constructor. Spelling it a second
        // time here is how the two would eventually disagree about the carrier
        // an external round trip must come back with.
        const returnTo = teamSignInReturnPath({
            teamId: selection.teamId,
            carrier: props.homeTarget,
        });
        return (
            <HomeAuthenticationFlow
                target={target.target}
                actions={[selected]}
                returnTo={returnTo}
                teamAdmission={{ teamId: selection.teamId, invitationToken: tokenParse.data, origin: selection.action.origin }}
                nativeAdmission={{ kind: 'team_invitation', token: tokenParse.data }}
                invitationEmailVerificationRequired={selection.invitationEmailVerificationRequired === true}
                onAuthenticated={(authenticatedHome) => {
                    // Authentication is not admission for an existing Account.
                    // Retain the mounted bearer and let credential-scope
                    // resolution return to this same explicit Join surface.
                    if (selected.execution.kind !== 'mtls'
                        && authenticatedHome.teamId === selection.teamId) {
                        setCompletedAdmission({
                            outcome: 'joined',
                            teamId: authenticatedHome.teamId,
                            teamName: selection.teamName,
                        });
                        return;
                    }
                    setSelection(null);
                    setRecoveringIdentity(false);
                }}
                onBack={() => setSelection(null)}
            />
        );
    }

    return (
        <TeamAuthEntrySurface
            invitation={props.postAuthContinuation && matchingScope
                ? { continuation: props.postAuthContinuation, accountScope: matchingScope }
                : { token: tokenParse.success ? tokenParse.data : '', accountScope: matchingScope ?? undefined }}
            target={target.target}
            onBack={exit}
            onUseCurrentAccount={recoveringIdentity ? useCurrentAccount : undefined}
            // This pre-acceptance choice re-opens authentication for the same
            // Home. It never consumes the invitation, signs anything out, or
            // changes which Home is focused.
            onRecoverIdentity={recoveringIdentity ? undefined : () => setRecoveringIdentity(true)}
            onSelectAction={(next) => setSelection(next)}
            onAdmissionComplete={(result) => {
                void openTeamOnExactHome(target.serverId, result.teamId);
            }}
        />
    );
});
