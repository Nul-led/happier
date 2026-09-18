import { TokenStorage } from '@/auth/storage/tokenStorage';
import {
    getServerProfileById,
    resolveServerProfileScopeIdForIdentifier,
} from '@/sync/domains/server/serverProfiles';
import { parseToken } from '@/utils/auth/parseToken';
import { createServerAccountScope, type ServerAccountScope } from './serverAccountScope';

export type ServerCredentialAccountScopeResolution =
    | Readonly<{ kind: 'resolving' }>
    | Readonly<{ kind: 'unknown_home' }>
    | Readonly<{ kind: 'signed_out' }>
    | Readonly<{ kind: 'bound'; scope: ServerAccountScope }>;


/** The credential-backed identity shared by routed projections and React readers. */
export async function resolveServerCredentialAccountScope(
    serverId: string,
): Promise<Exclude<ServerCredentialAccountScopeResolution, Readonly<{ kind: 'resolving' }>>> {
    const canonicalServerId = resolveServerProfileScopeIdForIdentifier(serverId);
    const profile = getServerProfileById(canonicalServerId);
    if (!profile?.serverUrl?.trim()) return { kind: 'unknown_home' };
    try {
        const credentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, {
            serverId: canonicalServerId,
        });
        const scope = createServerAccountScope(
            canonicalServerId,
            credentials ? parseToken(credentials.token) : null,
        );
        return scope ? { kind: 'bound', scope } : { kind: 'signed_out' };
    } catch {
        // Unreadable device credentials never establish an Account binding.
        return { kind: 'signed_out' };
    }
}
