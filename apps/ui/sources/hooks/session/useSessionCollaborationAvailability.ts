import type { SessionInitialAccessDraftV1 } from '@happier-dev/protocol';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

/**
 * Named Session access — Account, Team and Group grants, responsibility and
 * atomic initial access — is Session sharing: the exact Home's
 * `sharing.session` decision alone admits it. There is no partial mode.
 */
export type SessionCollaborationAvailability = 'unavailable' | 'available';

export function resolveSessionCollaborationAvailability(sharingEnabled: boolean): SessionCollaborationAvailability {
    return sharingEnabled ? 'available' : 'unavailable';
}

/** Exact Home scope uses the feature owner's server-specific snapshot. */
export function useSessionCollaborationAvailability(serverId: string): SessionCollaborationAvailability {
    return resolveSessionCollaborationAvailability(useFeatureEnabled('sharing.session', { scopeKind: 'spawn', serverId }));
}

/**
 * The one host-admission decision for the Collaboration destination.
 *
 * Named access is only one of the destination's children. `sharing.public` has
 * no catalog dependency on `sharing.session`, so a Home can publish links while
 * named access is off; hiding the destination there would remove the only entry
 * point publication has. Conversations needs no term of its own: the catalog
 * makes `sessions.conversations` depend on `sharing.session`, so it can never
 * outlive named access.
 */
export function resolveSessionCollaborationDestinationAdmitted(input: Readonly<{
    namedAccess: SessionCollaborationAvailability;
    publicLinkEnabled: boolean;
}>): boolean {
    return input.namedAccess !== 'unavailable' || input.publicLinkEnabled;
}

/**
 * Header, Session Info, the right sidebar and the Cockpit consume this decision
 * rather than each reducing named access to a route-local union.
 */
export function useSessionCollaborationDestinationAdmitted(serverId: string): boolean {
    const namedAccess = useSessionCollaborationAvailability(serverId);
    const publicLinkEnabled = useFeatureEnabled('sharing.public', { scopeKind: 'spawn', serverId });
    return resolveSessionCollaborationDestinationAdmitted({ namedAccess, publicLinkEnabled });
}

export function canCreateSessionWithInitialAccess(
    access: SessionInitialAccessDraftV1 | null | undefined,
    availability: SessionCollaborationAvailability,
): boolean {
    return !access?.grants.length || availability === 'available';
}
