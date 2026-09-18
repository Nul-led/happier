import { runtimeFetchWithServerReachability } from '@/sync/runtime/connectivity/serverReachabilityRuntimeFetch';
import {
    areServerAccountScopesEqual,
    createServerAccountScope,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';

import { resolveServerAccountRequestContext } from './resolveServerAccountRequestContext';
import { onceAsync } from './resolveServerScopedTransport';
import type {
    ResolvedServerAccountRequestContext,
} from './resolveServerAccountRequestContext';

type ScopedServerAccountRequestContext = Extract<
    ResolvedServerAccountRequestContext,
    { scope: 'scoped' }
>;

export type ServerAccountRequestOptions = Readonly<{
    /** Observes the canonical transport boundary; domain controllers must not infer it. */
    onIssued?: () => void;
}>;

export function createServerRequestForExplicitServerScope(params: Readonly<{
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
}>): (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response> {
    return async (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => {
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
            })(path, { ...init, method: init?.method ?? 'GET', headers }, {
                retry: 'none',
                ...(options?.onIssued ? { onIssued: options.onIssued } : {}),
            });
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
            ...(options?.onIssued ? { onIssued: options.onIssued } : {}),
        });
    };
}

export type ServerAccountRequestAuthority = Readonly<{
    scope: ServerAccountScope;
    context: ScopedServerAccountRequestContext;
    request: (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response>;
    release: () => Promise<void>;
}>;

export function createServerRequestForResolvedServerScope(params: Readonly<{
    context: ResolvedServerAccountRequestContext;
    activeRequest: (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response>;
}>): (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response> {
    return async (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => {
        if (params.context.scope === 'active') {
            return await params.activeRequest(path, init, options);
        }

        return await createServerRequestForExplicitServerScope({
            serverUrl: params.context.targetServerUrl,
            ...(params.context.runtimeOrigin ? { runtimeOrigin: params.context.runtimeOrigin } : {}),
            token: params.context.token,
            timeoutMs: params.context.timeoutMs,
            // The resolved transport already decided how this Home is reached;
            // dropping its carrier here would send every account-scoped request
            // to an origin an ingress-less Home does not have.
            ...(params.context.homeCarrier ? { homeCarrier: params.context.homeCarrier } : {}),
        })(path, init, options);
    };
}

export function createServerRequestWithServerScope(params: Readonly<{
    serverId?: string | null;
    timeoutMs?: number;
    preferScoped?: boolean;
    activeRequest: (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response>;
}>): (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response> {
    return async (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => {
        const context = await resolveServerAccountRequestContext({
            serverId: params.serverId ?? null,
            ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
            ...(params.preferScoped === true ? { preferScoped: true } : {}),
        });
        try {
            const response = await createServerRequestForResolvedServerScope({
                context,
                activeRequest: params.activeRequest,
            })(path, init, options);
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

type ServerAccountRequestTarget =
    | Readonly<{ scope: ServerAccountScope; serverId?: never }>
    | Readonly<{ serverId: string; scope?: never }>;

type CaptureServerAccountRequestParams = ServerAccountRequestTarget & Readonly<{
    activeRequest: (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response>;
}>;

export async function captureServerRequestAuthorityForServerAccountScope(params: CaptureServerAccountRequestParams): Promise<ServerAccountRequestAuthority> {
    const serverId = params.scope?.serverId ?? params.serverId;
    if (!serverId?.trim()) throw new Error('Account-scoped request requires an explicit Home');
    const context = await resolveServerAccountRequestContext({
        serverId,
        preferScoped: true,
    });
    if (context.scope !== 'scoped') {
        throw new Error('Account-scoped request did not resolve to scoped credentials');
    }
    const resolvedScope = createServerAccountScope(context.targetServerId, context.targetAccountId);
    if (!resolvedScope || (params.scope && !areServerAccountScopesEqual(resolvedScope, params.scope))) {
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
        scope: resolvedScope,
        context,
        request: createServerRequestForResolvedServerScope({
            context,
            activeRequest: params.activeRequest,
        }),
        release,
    };
}

export async function runWithServerRequestAuthorityForServerAccountScope<TResult>(params: CaptureServerAccountRequestParams, operation: (authority: ServerAccountRequestAuthority) => Promise<TResult>): Promise<TResult> {
    const authority = await captureServerRequestAuthorityForServerAccountScope(params);
    try {
        return await operation(authority);
    } finally {
        await authority.release();
    }
}

/** Response bytes stay under the same lease as the Account-authenticated request. */
export function createServerRequestForServerAccountScope(params: Readonly<{
    scope: ServerAccountScope;
    activeRequest: (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response>;
}>): (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response> {
    return (path, init, options) => runWithServerRequestAuthorityForServerAccountScope(params, async (authority) => {
        const response = await authority.request(path, init, options);
        if (response.body === null) return response;
        return new Response(await response.arrayBuffer(), {
            status: response.status, statusText: response.statusText, headers: response.headers,
        });
    });
}

/** Resolves an explicitly disposable authority; callers must release it. */
export async function resolveServerRequestForServerAccountScope(params: Readonly<{
    scope: ServerAccountScope;
    activeRequest: (path: string, init?: RequestInit, options?: ServerAccountRequestOptions) => Promise<Response>;
}>): Promise<ServerAccountRequestAuthority> {
    return await captureServerRequestAuthorityForServerAccountScope(params);
}
