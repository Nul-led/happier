import * as React from 'react';

import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';

/** Resolve once per transcript, never once per message or from a social profile. */
export function useSessionMessageViewerScope(
    sessionId: string,
    sessionServerId?: string | null,
): ServerAccountScope | null {
    const preferredServerId = usePreferredServerIdForSession({ serverId: sessionServerId, sessionId });
    const serverId = resolveServerProfileScopeIdForIdentifier(preferredServerId);
    const activeScope = useActiveServerAccountScope();
    const isActiveScope = activeScope != null
        && resolveServerProfileScopeIdForIdentifier(activeScope.serverId) === serverId;
    const resolution = useServerCredentialAccountScopeResolution(isActiveScope ? null : serverId);
    const accountId = isActiveScope
        ? activeScope.accountId
        : resolution.kind === 'bound' ? resolution.scope.accountId : null;
    return React.useMemo(() => serverId && accountId ? { serverId, accountId } : null, [serverId, accountId]);
}
