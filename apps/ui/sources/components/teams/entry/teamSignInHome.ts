import type { HomeTargetInput } from '@happier-dev/cli-common/homeTarget';

import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { resolveTeamJoinTarget } from '@/components/teams/join/teamJoinTarget';

/**
 * Which Home a public `/teams/:teamId/sign-in` link addresses.
 *
 * The Team page is scoped entry into one exact Home, so the Home must come from
 * the link rather than from whichever Home this device happens to have focused.
 * Child 02 §7.1 is explicit that "a device-local `ServerProfile.id` query value
 * is not a portable Home address": a profile id is local routing storage that
 * differs per device, so a link carrying one is unusable on the phone the person
 * actually opens it on.
 *
 * The portable carrier is therefore resolved through the same owner the join
 * link uses — there is one explicit-target carrier and one resolver for it, not
 * an invitation copy and a sign-in copy. The device-local `serverId` remains
 * accepted because in-app navigation and the OAuth `returnTo` still address the
 * already-adopted Home that way; it is a same-device convenience, never the
 * portable form.
 *
 * A Home this device has not adopted is not a failure. Unlike a join link, a
 * Team sign-in URL carries no bearer, so nothing secret is at stake — but the
 * entry projection still has to be requested from a Home whose identity this
 * build can verify, and adopting one is the existing Homes acquisition flow.
 */
export type TeamSignInHome =
    /**
     * The link named a Home this build can address. `savedProfileId` is null on
     * a device that has not adopted it: the target is still exact, it simply
     * has no local credential, which is the ordinary anonymous entry case.
     */
    | Readonly<{ kind: 'resolved'; target: HomeTargetInput; savedProfileId: string | null }>
    /** More than one saved profile claims that identity; picking one would guess. */
    | Readonly<{ kind: 'ambiguous' }>
    /** A real Home this device has not adopted, and cannot address from the link alone. */
    | Readonly<{ kind: 'unknown_home'; homeServerIdentityId: string }>
    /** No usable Home carrier at all. */
    | Readonly<{ kind: 'unresolved' }>;

const UNRESOLVED: TeamSignInHome = Object.freeze({ kind: 'unresolved' as const });
const AMBIGUOUS: TeamSignInHome = Object.freeze({ kind: 'ambiguous' as const });

export function resolveTeamSignInHome(params: Readonly<{
    /** The portable explicit-target carrier from the link. */
    carrier?: string | null;
    /** Device-local profile reference used by in-app navigation and OAuth return. */
    serverId?: string | null;
}>): TeamSignInHome {
    const carrier = String(params.carrier ?? '').trim();
    if (carrier) {
        const resolved = resolveTeamJoinTarget(carrier);
        if (resolved.kind === 'ambiguous') return AMBIGUOUS;
        if (resolved.kind === 'unknown_home') {
            return { kind: 'unknown_home', homeServerIdentityId: resolved.homeServerIdentityId };
        }
        if (resolved.kind === 'acquisition_required') {
            // A portable descriptor is still advisory until the Homes owner has
            // observed and adopted it. Team entry must not treat that descriptor
            // as an already-authorized request target; defer to the existing Add
            // Home flow just as an identity-only carrier does.
            return { kind: 'unknown_home', homeServerIdentityId: resolved.homeServerIdentityId };
        }
        if (resolved.kind === 'unresolved') return UNRESOLVED;
        return {
            kind: 'resolved',
            target: resolved.target,
            // Only a saved-profile target has a device-local credential to read.
            savedProfileId: resolved.target.kind === 'saved_profile'
                ? resolved.target.profileRef
                : null,
        };
    }

    const serverId = String(params.serverId ?? '').trim();
    if (!serverId) return UNRESOLVED;
    const profile = getServerProfileById(serverId);
    if (!profile) return { kind: 'unknown_home', homeServerIdentityId: serverId };
    return {
        kind: 'resolved',
        target: { kind: 'saved_profile', profileRef: profile.id },
        savedProfileId: profile.id,
    };
}

/**
 * The URL that returns to this exact page after an external round trip.
 *
 * The caller's own carrier is preserved verbatim rather than rewritten to the
 * resolved profile id, so a link opened on a device that later adopts the Home
 * still returns to the Home the link named.
 */
export function teamSignInReturnPath(params: Readonly<{
    teamId: string;
    carrier?: string | null;
    serverId?: string | null;
    postAuthInvitation?: boolean;
}>): string {
    const query = new URLSearchParams();
    const carrier = String(params.carrier ?? '').trim();
    const serverId = String(params.serverId ?? '').trim();
    if (carrier) query.set('target', carrier);
    if (serverId) query.set('serverId', serverId);
    if (params.postAuthInvitation) query.set('postAuthInvitation', '1');
    const search = query.toString();
    return `/teams/${encodeURIComponent(params.teamId)}/sign-in${search ? `?${search}` : ''}`;
}
