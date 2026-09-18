import { serverFetch } from '@/sync/http/client';
import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    captureServerRequestAuthorityForServerAccountScope,
    createServerRequestWithServerScope,
} from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { parseToken } from '@/utils/auth/parseToken';

type PeerMediationServerRequestTarget =
    | Readonly<{ serverId: string; authorityRequest?: never }>
    | Readonly<{ serverId?: never; authorityRequest: (path: string, init?: RequestInit) => Promise<Response> }>;

export async function requestPeerMediationServerJson(params: PeerMediationServerRequestTarget & Readonly<{
    path: string;
    init: RequestInit;
    timeoutMs?: number;
}>): Promise<Readonly<{ ok: boolean; status: number; body: unknown }>> {
    const request = params.authorityRequest ?? createServerRequestWithServerScope({
        serverId: params.serverId,
        ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        activeRequest: async (path, init) => await serverFetch(path, init, {
            ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        }),
    });
    const response = await request(params.path, params.init);
    return {
        ok: response.ok,
        status: response.status,
        body: await response.json().catch(() => null),
    };
}

/** Binds the grant request to the exact target credential observed by its caller. */
export async function requestPeerMediationServerJsonForCredential(params: Readonly<{
    serverId: string;
    token: string;
    path: string;
    init: RequestInit;
    timeoutMs?: number;
}>): Promise<Readonly<{ ok: boolean; status: number; body: unknown }>> {
    const scope = createServerAccountScope(params.serverId, parseToken(params.token));
    if (!scope) throw new Error('Peer mediation request is missing a target Account scope');
    const authority = await captureServerRequestAuthorityForServerAccountScope({
        scope,
        activeRequest: async (path, init) => await serverFetch(path, init, {
            ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        }),
    });
    try {
        return await requestPeerMediationServerJson({
            authorityRequest: authority.request,
            path: params.path,
            init: params.init,
            ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        });
    } finally {
        await authority.release();
    }
}
