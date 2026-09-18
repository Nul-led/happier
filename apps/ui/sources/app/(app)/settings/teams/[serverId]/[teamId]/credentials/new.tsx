import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialCreateScreen } from '@/components/settings/teams/credentials/TeamCredentialCreateScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialCreateScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        credentialSourcePluginId?: string | string[];
        credentialSourceKind?: string | string[];
        credentialSourceLocalId?: string | string[];
        credentialSourceAccountId?: string | string[];
        credentialSourceGroupId?: string | string[];
        credentialSourceConnectionId?: string | string[];
        credentialSourceSlotId?: string | string[];
        credentialSourceMachineId?: string | string[];
        credentialSourceConnectionSecurityFingerprint?: string | string[];
    }>();
    const pluginId = firstRouteParam(params.credentialSourcePluginId);
    const localId = firstRouteParam(params.credentialSourceLocalId);
    const accountId = firstRouteParam(params.credentialSourceAccountId);
    const groupId = firstRouteParam(params.credentialSourceGroupId);
    const kind = firstRouteParam(params.credentialSourceKind);
    const connectionId = firstRouteParam(params.credentialSourceConnectionId);
    const credentialSlotId = firstRouteParam(params.credentialSourceSlotId);
    const machineId = firstRouteParam(params.credentialSourceMachineId);
    const connectionSecurityFingerprint = firstRouteParam(params.credentialSourceConnectionSecurityFingerprint);
    const sourceHint = kind === 'provider_connection' && connectionId && credentialSlotId && machineId && connectionSecurityFingerprint
        ? { kind: 'provider_connection' as const, machineId, connectionId, credentialSlotId, connectionSecurityFingerprint }
        : pluginId && localId
        ? kind === 'connected_pool' && groupId
            ? { kind: 'connected_pool' as const, pluginId, localId, groupId }
            : accountId
                ? { kind: 'connected_account' as const, pluginId, localId, accountId }
                : undefined
        : undefined;
    return (
        <TeamCredentialCreateScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            sourceHint={sourceHint}
        />
    );
}
