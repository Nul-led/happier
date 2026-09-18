import type { SessionInitialAccessDraftV1 } from '@happier-dev/protocol';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

export type SessionCollaborationAvailability = 'unavailable' | 'direct_only' | 'full_collaboration';

export function resolveSessionCollaborationAvailability(
    sharingEnabled: boolean,
    collaborationEnabled: boolean,
): SessionCollaborationAvailability {
    if (!sharingEnabled) return 'unavailable';
    return collaborationEnabled ? 'full_collaboration' : 'direct_only';
}

/** Exact Home scope uses the feature owner's server-specific snapshot. */
export function useSessionCollaborationAvailability(serverId: string): SessionCollaborationAvailability {
    const scope = { scopeKind: 'spawn' as const, serverId };
    const sharingEnabled = useFeatureEnabled('sharing.session', scope);
    const collaborationEnabled = useFeatureEnabled('sessions.collaboration', scope);
    return resolveSessionCollaborationAvailability(sharingEnabled, collaborationEnabled);
}

/**
 * The one host-admission decision for the Collaboration destination.
 *
 * Named access is only one of the destination's children. `sharing.public` has
 * no catalog dependency on `sharing.session`, so a Home can publish links while
 * named access is off; hiding the destination there would remove the only entry
 * point publication has. Conversations needs no term of its own: the catalog
 * makes `sessions.conversations` depend on `sessions.collaboration`, which
 * depends on `sharing.session`, so it can never outlive named access.
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
    return !access?.grants.length || availability === 'full_collaboration';
}
