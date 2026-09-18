import { createServerFetchAtEndpoint } from '@/sync/http/client';
import type { AccountDirectoryAuthTransport } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import type { HomeOAuthRequestContext, TeamOAuthRequestContext } from './types';

export type HomeExternalAuthTarget = Readonly<{
    serverId?: string;
    serverUrl?: string;
}>;

export function captureHomeExternalAuthTarget(input: Readonly<{
    serverId?: string | null;
    serverUrl?: string | null;
}>): HomeExternalAuthTarget {
    const serverId = String(input.serverId ?? '').trim();
    const serverUrl = String(input.serverUrl ?? '').trim();
    return {
        ...(serverId ? { serverId } : {}),
        ...(serverUrl ? { serverUrl } : {}),
    };
}

export function createHomeOAuthRequestContext(
    target: HomeExternalAuthTarget,
    transport?: AccountDirectoryAuthTransport,
    signal?: AbortSignal,
): HomeOAuthRequestContext | null {
    const serverId = String(target.serverId ?? '').trim();
    const serverUrl = String(target.serverUrl ?? '').trim();
    if (!serverId || !serverUrl) return null;
    return {
        target: { serverId, serverUrl },
        request: createServerFetchAtEndpoint({
            endpointUrl: serverUrl,
            serverId,
            ...(transport?.runtimeOrigin ? { runtimeOrigin: transport.runtimeOrigin } : {}),
            ...(transport?.homeCarrier ? { homeCarrier: transport.homeCarrier } : {}),
            signal,
        }),
    };
}

export function createTeamOAuthRequestContext(
    target: HomeExternalAuthTarget,
    teamId: string,
    transport?: AccountDirectoryAuthTransport,
    signal?: AbortSignal,
    invitationToken?: string,
    origin: 'home' | 'team' = 'team',
): TeamOAuthRequestContext | null {
    const home = createHomeOAuthRequestContext(target, transport, signal);
    const normalizedTeamId = teamId.trim();
    if (!home || !normalizedTeamId) return null;
    return {
        ...home,
        purpose: 'team_admission',
        teamId: normalizedTeamId,
        origin,
        ...(invitationToken ? { invitationToken } : {}),
    };
}
