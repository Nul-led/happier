import * as React from 'react';

import { resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { resolveServerCredentialAccountScope } from '@/sync/domains/scope/serverCredentialAccountScope';
import {
    useServerCredentialAccountScopeResolutions,
    type ServerCredentialAccountScopeResolution,
} from '@/sync/domains/scope/useServerCredentialAccountScopes';

export type ServerAuthStatus = 'signedIn' | 'signedOut' | 'unknown';

/**
 * Only a confirmed absent credential is `signedOut`. A Home still resolving, an
 * unreadable credential store, or an unknown Home is `unknown` and must never
 * be routed to sign-in.
 */
export function serverAuthStatusFromCredentialResolution(
    resolution: ServerCredentialAccountScopeResolution | undefined,
): ServerAuthStatus {
    if (resolution?.kind === 'bound') return 'signedIn';
    if (resolution?.kind === 'signed_out') return 'signedOut';
    return 'unknown';
}

/** One Home's current credential state, read through the canonical resolver. */
export async function readServerAuthStatus(serverId: string): Promise<ServerAuthStatus> {
    return serverAuthStatusFromCredentialResolution(await resolveServerCredentialAccountScope(serverId));
}

type ServerProfileLike = Pick<ServerProfile, 'id' | 'serverUrl' | 'serverIdentityId'>;

export function useServerAuthStatusByServerId(servers: ReadonlyArray<ServerProfileLike>): Readonly<Record<string, ServerAuthStatus>> {
    const serverIds = React.useMemo(
        () => servers.map((profile) => resolveServerProfileScopeId(profile)),
        [servers],
    );
    const resolutions = useServerCredentialAccountScopeResolutions(serverIds);

    return React.useMemo(() => {
        const statusById: Record<string, ServerAuthStatus> = {};
        for (const serverId of serverIds) {
            statusById[serverId] = serverAuthStatusFromCredentialResolution(resolutions.get(serverId));
        }
        return statusById;
    }, [resolutions, serverIds]);
}
