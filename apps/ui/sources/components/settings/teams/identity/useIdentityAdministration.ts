import * as React from 'react';
import { TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1 } from '@happier-dev/protocol';

import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { serverAccountScopedTeamKey, type TeamAddress } from '@/sync/domains/teams/teamAddress';
import { subscribeHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

import { createIdentityAdministrationClient } from './identityAdministrationClient';
import {
    beginIdentityAdministrationRefresh,
    INITIAL_IDENTITY_ADMINISTRATION_STATE,
    settleIdentityAdministrationRefresh,
    type IdentityAdministrationState,
} from './identityAdministrationState';

export type IdentityAdministrationBinding = Readonly<{
    state: IdentityAdministrationState;
    refresh: () => void;
}>;

type BoundIdentityAdministrationState = Readonly<{
    bindingKey: string;
    value: IdentityAdministrationState;
}>;

/**
 * Route-local identity connection projection for one exact Home/Account/Team.
 *
 * The server remains the authority. This hook retains only the last list answer
 * needed to preserve same-scope refresh continuity. State is qualified by the
 * canonical exact-Team key, so an old render or answer cannot cross scope.
 */
export function useIdentityAdministration(
    scope: ServerAccountScope,
    teamId: string,
): IdentityAdministrationBinding {
    const address: TeamAddress = { serverId: scope.serverId, teamId };
    const bindingKey = serverAccountScopedTeamKey(scope, address);
    const [boundState, setBoundState] = React.useState<BoundIdentityAdministrationState>(() => ({
        bindingKey,
        value: INITIAL_IDENTITY_ADMINISTRATION_STATE,
    }));
    const [refreshGeneration, setRefreshGeneration] = React.useState(0);
    const client = React.useMemo(
        () => createIdentityAdministrationClient(scope),
        [scope.serverId, scope.accountId],
    );
    const state = boundState.bindingKey === bindingKey
        ? boundState.value
        : INITIAL_IDENTITY_ADMINISTRATION_STATE;

    React.useEffect(() => {
        const controller = new AbortController();
        setBoundState((current) => ({
            bindingKey,
            value: current.bindingKey === bindingKey
                ? beginIdentityAdministrationRefresh(current.value)
                : INITIAL_IDENTITY_ADMINISTRATION_STATE,
        }));
        void client.execute(
            'teams.identity.connections.list',
            { v: 1, teamId },
            { signal: controller.signal },
        ).then((result) => {
            if (controller.signal.aborted) return;
            setBoundState((current) => current.bindingKey !== bindingKey
                ? current
                : {
                    bindingKey,
                    value: settleIdentityAdministrationRefresh(
                        current.value,
                        result.ok
                            ? {
                                ok: true,
                                items: result.value.items,
                                eligibleProviders: result.value.eligibleProviders,
                                admissionModeApplicability: result.value.admissionModeApplicability,
                                memberSignInUrl: result.value.memberSignInUrl,
                            }
                            : { ok: false, failure: result.failure },
                    ),
                });
        });
        return () => controller.abort();
    }, [bindingKey, client, teamId, refreshGeneration]);

    const refresh = React.useCallback(() => {
        // Publish the transition synchronously so return-to-app consumers can
        // wait for the new authoritative projection instead of acting on the
        // last screen snapshot while the request effect is being scheduled.
        setBoundState((current) => current.bindingKey !== bindingKey
            ? current
            : { bindingKey, value: beginIdentityAdministrationRefresh(current.value) });
        setRefreshGeneration((current) => current + 1);
    }, [bindingKey]);

    React.useEffect(() => subscribeHomeAccountChange((event) => {
        if (event.serverId !== scope.serverId) return;
        if (event.entityIds !== undefined
            && !event.entityIds.includes(TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1)) return;
        refresh();
    }), [refresh, scope.serverId]);

    return React.useMemo(() => ({ state, refresh }), [state, refresh]);
}
