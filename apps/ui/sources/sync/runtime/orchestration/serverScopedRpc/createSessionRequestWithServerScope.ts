import { runtimeFetchWithServerReachability } from '@/sync/runtime/connectivity/serverReachabilityRuntimeFetch';
import {
    areServerAccountScopesEqual,
    createServerAccountScope,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';

import { resolveServerScopedSessionContext } from './resolveServerScopedSessionContext';
import { onceAsync } from './resolveServerScopedTransport';
import type {
    ResolvedServerSessionRpcContext,
} from './resolveServerScopedSessionContext';

type ScopedServerSessionRpcContext = Extract<
    ResolvedServerSessionRpcContext,
    { scope: 'scoped' }
>;

export function createSessionRequestForExplicitServerScope(params: Readonly<{
    serverUrl: string;
    runtimeOrigin?: string;
    token: string;
    timeoutMs?: number;
    /**
     * A Home that owns its own bytes and has no origin a URL fetch can reach
     * (browser Iroh, Lane 06 A7.3/A7.4). When one is resolved, it — not the
     * canonical URL — is how this request travels; the URL keeps describing
     * identity, audience and logging exactly as it does for every other carrier.
     */
    homeCarrier?: HomeCarrier;
}>): (path: string, init?: RequestInit) => Promise<Response> {
    return async (path: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${params.token}`);
        if (params.homeCarrier) {
            // The canonical HTTP owner already knows how to compose a request
            // for a semantic carrier; this seam supplies the carrier and the
            // scoped credential rather than adding a second request composer.
            return await createServerFetchAtEndpoint({
                endpointUrl: params.serverUrl,
                homeCarrier: params.homeCarrier,
                credentials: { token: params.token },
            })(path, { ...init, method: init?.method ?? 'GET', headers }, { retry: 'none' });
        }
        return await runtimeFetchWithServerReachability({
            serverUrl: params.serverUrl,
            token: params.token,
            url: `${params.runtimeOrigin ?? params.serverUrl}${path}`,
            ...(params.runtimeOrigin ? { runtimeOrigin: params.runtimeOrigin } : {}),
            ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
            init: {
                ...init,
                method: init?.method ?? 'GET',
                headers,
            },
        });
    };
}

export type ServerAccountSessionRequestAuthority = Readonly<{
    scope: ServerAccountScope;
    context: ScopedServerSessionRpcContext;
    request: (path: string, init?: RequestInit) => Promise<Response>;
    release: () => Promise<void>;
}>;

export function createSessionRequestForResolvedServerScope(params: Readonly<{
    context: ResolvedServerSessionRpcContext;
    activeRequest: (path: string, init?: RequestInit) => Promise<Response>;
}>): (path: string, init?: RequestInit) => Promise<Response> {
    return async (path: string, init?: RequestInit) => {
        if (params.context.scope === 'active') {
            return await params.activeRequest(path, init);
        }

        return await createSessionRequestForExplicitServerScope({
            serverUrl: params.context.targetServerUrl,
            ...(params.context.runtimeOrigin ? { runtimeOrigin: params.context.runtimeOrigin } : {}),
            token: params.context.token,
            timeoutMs: params.context.timeoutMs,
            // The resolved transport already decided how this Home is reached;
            // dropping its carrier here would send every account-scoped request
            // to an origin an ingress-less Home does not have.
            ...(params.context.homeCarrier ? { homeCarrier: params.context.homeCarrier } : {}),
        })(path, init);
    };
}

export function createSessionRequestWithServerScope(params: Readonly<{
    serverId?: string | null;
    timeoutMs?: number;
    preferScoped?: boolean;
    activeRequest: (path: string, init?: RequestInit) => Promise<Response>;
}>): (path: string, init?: RequestInit) => Promise<Response> {
    return async (path: string, init?: RequestInit) => {
        const context = await resolveServerScopedSessionContext({
            serverId: params.serverId ?? null,
            ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
            ...(params.preferScoped === true ? { preferScoped: true } : {}),
        });
        try {
            const response = await createSessionRequestForResolvedServerScope({
                context,
                activeRequest: params.activeRequest,
            })(path, init);
            if (context.scope === 'active' || response.body === null) return response;

            // A scoped Iroh origin is lease-backed. Buffer these JSON/control
            // responses before releasing the lease so callers can consume the
            // returned Response without racing tunnel teardown.
            const body = await response.arrayBuffer();
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        } finally {
            if (context.scope === 'scoped') await context.release?.();
        }
    };
}

export async function captureSessionRequestAuthorityForServerAccountScope(params: Readonly<{
    scope: ServerAccountScope;
    activeRequest: (path: string, init?: RequestInit) => Promise<Response>;
}>): Promise<ServerAccountSessionRequestAuthority> {
    const context = await resolveServerScopedSessionContext({
        serverId: params.scope.serverId,
        preferScoped: true,
    });
    if (context.scope !== 'scoped') {
        throw new Error('Account-scoped request did not resolve to scoped credentials');
    }
    const resolvedScope = createServerAccountScope(context.targetServerId, context.targetAccountId);
    if (!areServerAccountScopesEqual(resolvedScope, params.scope)) {
        await context.release?.();
        throw new Error('Account-scoped request authenticated account does not match requested scope');
    }
    // Release ownership must survive a rejection: coalesce concurrent callers,
    // propagate the first rejection, and retry the underlying release on the
    // next explicit call instead of losing custody before the await resolves.
    const release = onceAsync(async () => {
        await context.release?.();
    });
    return {
        scope: params.scope,
        context,
        request: createSessionRequestForResolvedServerScope({
            context,
            activeRequest: params.activeRequest,
        }),
        release,
    };
}

export async function runWithSessionRequestAuthorityForServerAccountScope<TResult>(params: Readonly<{
    scope: ServerAccountScope;
    activeRequest: (path: string, init?: RequestInit) => Promise<Response>;
}>, operation: (authority: ServerAccountSessionRequestAuthority) => Promise<TResult>): Promise<TResult> {
    const authority = await captureSessionRequestAuthorityForServerAccountScope({
        scope: params.scope,
        activeRequest: params.activeRequest,
    });
    try {
        return await operation(authority);
    } finally {
        await authority.release();
    }
}

/** Resolves an explicitly disposable authority; callers must release it. */
export async function resolveSessionRequestForServerAccountScope(params: Readonly<{
    scope: ServerAccountScope;
    activeRequest: (path: string, init?: RequestInit) => Promise<Response>;
}>): Promise<ServerAccountSessionRequestAuthority> {
    return await captureSessionRequestAuthorityForServerAccountScope(params);
}
