import { runtimeFetchWithServerReachability } from '@/sync/runtime/connectivity/serverReachabilityRuntimeFetch';
import {
    areServerAccountScopesEqual,
    createServerAccountScope,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';

import { resolveServerScopedSessionContext } from './resolveServerScopedSessionContext';
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
}>): (path: string, init?: RequestInit) => Promise<Response> {
    return async (path: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${params.token}`);
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
        })(path, init);
    };
}

export function createSessionRequestWithServerScope(params: Readonly<{
    serverId?: string | null;
    activeRequest: (path: string, init?: RequestInit) => Promise<Response>;
}>): (path: string, init?: RequestInit) => Promise<Response> {
    return async (path: string, init?: RequestInit) => {
        const context = await resolveServerScopedSessionContext({ serverId: params.serverId ?? null });
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
    let released = false;
    const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        await context.release?.();
    };
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
