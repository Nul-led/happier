import type { ScopedSocketConnectParams } from './serverScopedRpcTypes';
import { resolvePortableServerIdentityForRoutingId } from '@/sync/domains/server/resolvePortableServerIdentityForRoutingId';

type ScopedSocketCarrierContext = Readonly<{
    targetServerId?: string;
    targetServerUrl: string;
    runtimeOrigin?: string;
    carrier?: 'https' | 'iroh';
    homeCarrier?: ScopedSocketConnectParams['homeCarrier'];
    release?: () => Promise<void>;
    token: string;
    timeoutMs: number;
}>;

/**
 * Maps a resolved scoped context into one pooled socket acquisition. The pool
 * invokes `takeCarrierRelease` only when it must create a physical entry, so a
 * reused entry leaves the caller holding its redundant context release.
 */
export function createScopedSocketConnectParams(
    context: ScopedSocketCarrierContext,
    takeCarrierRelease: () => (() => Promise<void>) | undefined = () => context.release,
): ScopedSocketConnectParams {
    const homeIdentityId = resolvePortableServerIdentityForRoutingId(context.targetServerId);
    return {
        serverUrl: context.runtimeOrigin ?? context.targetServerUrl,
        reachabilityServerUrl: context.targetServerUrl,
        ...(homeIdentityId ? { homeIdentityId } : {}),
        ...(context.carrier ? { carrier: context.carrier } : {}),
        ...(context.homeCarrier ? { homeCarrier: context.homeCarrier } : {}),
        takeCarrierRelease,
        token: context.token,
        timeoutMs: context.timeoutMs,
    };
}
