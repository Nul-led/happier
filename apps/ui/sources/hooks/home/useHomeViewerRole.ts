import type { HomeRoleV1 } from '@happier-dev/protocol/home/governance';

import { useHomeAdministration } from './useHomeAdministration';
import { resolveHomeViewerRole } from './resolveHomeViewerRole';

/**
 * The viewer's role in one Home, from that Home's governance projection: `null` while it is not
 * known (first loading, signed out, refused, or a Home without an owner yet). The governance view
 * owner retains an observed role through transient read failures and withdraws it on refusal.
 * It never waits: callers show the fact once the Home has answered.
 */
export function useHomeViewerRole(serverId: string): HomeRoleV1 | null {
    return resolveHomeViewerRole(useHomeAdministration(serverId));
}
