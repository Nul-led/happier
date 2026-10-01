import * as React from 'react';

import { removeServerProfileUiAction } from '@/components/serverProfiles/removeServerProfileUiAction';
import { usePersonalHomeRuntimeOperations } from '@/components/settings/server/localControl/usePersonalHomeRuntimeOperations';
import { useServerCredentialAccountScopeResolutions } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { resolveServerCredentialAccountScope } from '@/sync/domains/scope/serverCredentialAccountScope';
import { resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { getHomeEmptiness } from '@/sync/ops/home/homeGovernanceOperations';

export type EmptyPersonalHomeRemoval = Readonly<{
    /** Removes the Personal Home after re-reading that it is still empty. */
    remove: () => Promise<'removed' | 'not_empty' | 'unavailable'>;
}>;

async function readEmpty(serverId: string): Promise<boolean | null> {
    const resolution = await resolveServerCredentialAccountScope(serverId);
    if (resolution.kind !== 'bound') return null;
    const outcome = await getHomeEmptiness({ scope: resolution.scope });
    return outcome.kind === 'succeeded' ? outcome.value.isEmpty : null;
}

/**
 * "Remove the empty Personal Home" (J2, J3): offered only when the Personal Home this device made
 * says itself that it is empty — no sessions, other people, Teams or pending invitations — through
 * the Home governance owner (`getHomeEmptiness`, the `home.emptiness.get` Action). A failed or
 * unanswered read is unknown, never empty, so the option simply is not offered. Removal reads it
 * again at the moment of removal, then stops and uninstalls the runtime and removes the saved Home
 * through their owners (`usePersonalHomeRuntimeOperations`, `removeServerProfileUiAction`).
 */
export function useEmptyPersonalHomeRemoval(profile: ServerProfile | null): EmptyPersonalHomeRemoval | null {
    const serverId = profile ? resolveServerProfileScopeId(profile) : null;
    const serverIds = React.useMemo(() => (serverId ? [serverId] : []), [serverId]);
    const resolutions = useServerCredentialAccountScopeResolutions(serverIds);
    const bound = serverId ? resolutions.get(serverId)?.kind === 'bound' : false;
    const [empty, setEmpty] = React.useState<Readonly<{ serverId: string; isEmpty: boolean }> | null>(null);
    const { operations } = usePersonalHomeRuntimeOperations();

    React.useEffect(() => {
        if (!serverId || !bound) return;
        let cancelled = false;
        void readEmpty(serverId).then((isEmpty) => {
            if (!cancelled && isEmpty !== null) setEmpty({ serverId, isEmpty });
        }, () => {});
        return () => { cancelled = true; };
    }, [bound, serverId]);

    const uninstallRuntime = operations.uninstallRuntime;
    const remove = React.useCallback(async () => {
        if (!profile || !serverId || !uninstallRuntime) return 'unavailable' as const;
        const stillEmpty = await readEmpty(serverId);
        if (stillEmpty === null) return 'unavailable' as const;
        if (!stillEmpty) {
            setEmpty({ serverId, isEmpty: false });
            return 'not_empty' as const;
        }
        await uninstallRuntime();
        const removed = await removeServerProfileUiAction({ profileId: profile.id, serverUrl: profile.serverUrl });
        return removed.kind === 'completed' ? 'removed' as const : 'unavailable' as const;
    }, [profile, serverId, uninstallRuntime]);

    const offered = empty !== null && empty.serverId === serverId && empty.isEmpty && !!uninstallRuntime;
    return React.useMemo(() => (offered ? { remove } : null), [offered, remove]);
}
