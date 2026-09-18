import * as React from 'react';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useMachinePoolProjections, type MachinePoolProjectionMachine } from './useMachinePoolProjections';

const EMPTY_MACHINES: readonly MachinePoolProjectionMachine[] = [];

/** Joins informational origin to the viewer's readable Home projection, never to a stored label. */
export function useMachinePoolOriginName(params: Readonly<{
    serverId: string | null;
    poolId: string | null;
    machines?: readonly MachinePoolProjectionMachine[];
}>): string | null {
    // Session access and an origin ID do not authorize a Pool read. Resolve the viewer's own
    // credential for this Home first, then consume the same projection as Settings/New Session.
    const credentialScope = useServerCredentialAccountScopeResolution(params.poolId ? params.serverId : null);
    const serverId = credentialScope.kind === 'bound' ? credentialScope.scope.serverId : null;
    const machines = params.machines ?? EMPTY_MACHINES;
    const scopes = React.useMemo(() => serverId ? [{ serverId, machines }] : [], [serverId, machines]);
    const projections = useMachinePoolProjections(scopes);
    return params.poolId
        ? projections[0]?.pools.find((view) => view.pool.id === params.poolId)?.pool.name.trim() || null
        : null;
}
