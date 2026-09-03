import { createServerFetchAtEndpoint } from '@/sync/http/client';
import type { HomeOAuthRequestContext } from './types';

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
): HomeOAuthRequestContext | null {
    const serverId = String(target.serverId ?? '').trim();
    const serverUrl = String(target.serverUrl ?? '').trim();
    if (!serverId || !serverUrl) return null;
    return {
        target: { serverId, serverUrl },
        request: createServerFetchAtEndpoint({
            endpointUrl: serverUrl,
            serverId,
        }),
    };
}
