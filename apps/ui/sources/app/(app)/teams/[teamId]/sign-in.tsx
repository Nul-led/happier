import * as React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { TeamAuthEntrySurface } from '@/components/teams/entry/TeamAuthEntrySurface';
import type { TeamAuthEntrySelection } from '@/components/teams/entry/TeamAuthEntrySurface';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';
import { teamSessionsPath } from '@/components/settings/teams/teamsRoutes';
import { HomeAuthenticationFlow } from '@/components/account/auth/HomeAuthenticationFlow';
import { projectTeamAuthSelection } from '@/components/teams/entry/teamAuthAction';
import { resolveTeamSignInHome, teamSignInReturnPath } from '@/components/teams/entry/teamSignInHome';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import type { TeamInvitationPostAuthContinuationV1 } from '@happier-dev/protocol/teams';
import { TeamJoinScreen } from '@/components/teams/join/TeamJoinScreen';

/**
 * Public Team authentication entry; the Home remains explicitly addressed.
 *
 * Every hook runs before the first branch so the state/loading/ready sequence
 * this page moves through cannot reorder them, and no branch renders `null`:
 * a link that cannot be routed still explains itself and offers a way forward.
 */
export default function TeamSignInRoute() {
    const params = useLocalSearchParams<{
        teamId?: string | string[];
        serverId?: string | string[];
        target?: string | string[];
        postAuthInvitation?: string | string[];
    }>();
    const router = useRouter();
    const teamId = firstRouteParam(params.teamId);
    const serverId = firstRouteParam(params.serverId);
    const carrier = firstRouteParam(params.target);
    const expectsPostAuthInvitation = firstRouteParam(params.postAuthInvitation) === '1';
    // Adopting the Home while this page is open must re-resolve it, otherwise
    // somebody who adds the Home from the recovery action below stays stranded.
    const profilesGeneration = useServerProfilesGeneration();
    const home = React.useMemo(
        () => resolveTeamSignInHome({ carrier, serverId }),
        [carrier, serverId, profilesGeneration],
    );
    const savedProfileId = home.kind === 'resolved' ? home.savedProfileId : null;
    const scopeResolution = useServerCredentialAccountScopeResolution(savedProfileId);
    const [selection, setSelection] = React.useState<TeamAuthEntrySelection | null>(null);
    const selected = selection ? projectTeamAuthSelection(selection) : null;
    const [postAuthState, setPostAuthState] = React.useState<
        | Readonly<{ kind: 'loading' }>
        | Readonly<{ kind: 'ready'; continuation: TeamInvitationPostAuthContinuationV1 }>
        | Readonly<{ kind: 'unavailable' }>
    >({ kind: 'loading' });
    const postAuthClaimRef = React.useRef<Promise<typeof postAuthState> | null>(null);

    React.useEffect(() => {
        if (postAuthState.kind !== 'loading' || !expectsPostAuthInvitation || !teamId || home.kind !== 'resolved'
            || scopeResolution.kind !== 'bound') return;
        let active = true;
        postAuthClaimRef.current ??= (async () => {
            const state = await TokenStorage.readPendingExternalAuthContinuationState();
            const pending = state.value;
            const continuation = pending?.postAuthInvitation;
            const matches = !state.serverMismatch && continuation
                && pending?.serverUrl
                && continuation.teamId === teamId
                && pending?.teamContinuation?.teamId === teamId
                && pending.teamContinuation.homeServerIdentityId === carrier;
            if (!matches) {
                return { kind: 'unavailable' } as const;
            }
            const cleared = await TokenStorage.clearPendingExternalAuth({
                serverUrl: pending.serverUrl,
                serverId: pending.serverId,
                removeExact: pending,
            });
            return cleared
                ? { kind: 'ready', continuation } as const
                : { kind: 'unavailable' } as const;
        })();
        void postAuthClaimRef.current.then((next) => {
            if (active) setPostAuthState(next);
        });
        return () => { active = false; };
    }, [expectsPostAuthInvitation, home, postAuthState.kind, scopeResolution, teamId]);

    // Two unusable-target states with two different remedies, matching the join
    // surface: a carrier this build cannot route is terminal for this device,
    // while a Home it simply has not adopted is the ordinary first-device case.
    if (!teamId || home.kind === 'unresolved' || home.kind === 'ambiguous') {
        return (
            <SurfaceStateCard
                testID={home.kind === 'ambiguous'
                    ? 'team-sign-in-ambiguous-home'
                    : 'team-sign-in-unknown-target'}
                kind="unavailable"
                title={t('teams.entry.unknownTargetTitle')}
                reason={t('teams.entry.unknownTargetBody')}
                action={{ label: t('common.back'), onPress: () => router.replace('/') }}
                accessibilitySemantics="status"
            />
        );
    }
    if (home.kind === 'unknown_home') {
        return (
            <SurfaceStateCard
                testID="team-sign-in-add-home"
                kind="unavailable"
                title={t('teams.join.unknownHomeTitle')}
                reason={t('server.notificationAddServerHint')}
                action={{ label: t('server.addServerTitle'), onPress: () => router.push('/server') }}
                accessibilitySemantics="status"
            />
        );
    }
    // Only a Home with a local credential has a scope to wait for. A Home this
    // device addresses but has not signed in to is simply an anonymous visit.
    if (savedProfileId !== null && scopeResolution.kind === 'resolving') {
        return (
            <SurfaceStateCard
                testID="team-sign-in-resolving"
                kind="loading"
                title={t('common.loading')}
                accessibilitySemantics="status"
            />
        );
    }

    // A post-auth marker does not prove a usable Account credential. Only the
    // bound state may claim the opaque continuation; signed-out/unreadable
    // credential states keep custody intact and use the ordinary exact-Home
    // authentication surface below.
    if (expectsPostAuthInvitation && scopeResolution.kind === 'bound') {
        if (postAuthState.kind === 'loading') return (
            <SurfaceStateCard testID="team-sign-in-post-auth-loading" kind="loading" title={t('common.loading')} accessibilitySemantics="status" />
        );
        if (postAuthState.kind === 'unavailable') return (
            <SurfaceStateCard
                testID="team-sign-in-post-auth-unavailable"
                kind="unavailable"
                title={t('teams.join.inactiveTitle')}
                reason={t('teams.join.askForNew')}
                action={{ label: t('common.back'), onPress: () => router.replace('/') }}
                accessibilitySemantics="status"
            />
        );
        return (
            <TeamJoinScreen
                postAuthContinuation={postAuthState.continuation}
                homeTarget={carrier ?? serverId}
            />
        );
    }

    const returnTo = teamSignInReturnPath({
        teamId,
        carrier,
        serverId,
        postAuthInvitation: expectsPostAuthInvitation,
    });
    if (selection && selected) {
        // A Home-origin mTLS action still needs the exact Team-bound native
        // continuation. Unlike ordinary Home mTLS, the native callback must
        // return to this Team without inferring it from the focused Home or
        // manufacturing membership authority.
        const requiresTeamContinuation = selection.action.origin === 'team'
            || selected.execution.kind === 'mtls';
        return (
            <HomeAuthenticationFlow
                target={home.target}
                actions={[selected]}
                returnTo={returnTo}
                teamAdmission={requiresTeamContinuation ? { teamId: selection.teamId } : undefined}
                onAuthenticated={() => router.replace(returnTo)}
                onBack={() => setSelection(null)}
            />
        );
    }
    if (scopeResolution.kind === 'bound') return (
        <TeamAuthEntrySurface
            teamId={teamId}
            target={home.target}
            accountScope={scopeResolution.scope}
            onContinue={() => router.replace(teamSessionsPath({
                serverId: scopeResolution.scope.serverId,
                teamId,
            }))}
            onSelectAction={(next) => setSelection(next)}
        />
    );
    return (
        <TeamAuthEntrySurface
            teamId={teamId}
            target={home.target}
            onSelectAction={(next) => setSelection(next)}
        />
    );
}
