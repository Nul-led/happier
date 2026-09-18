import { createNotAuthenticatedError } from '@/sync/runtime/connectivity/authErrors';
import type { SessionRouteHydrationState } from '@/sync/domains/session/sessionRouteHydrationState';

export type SessionAuthSurfaceState = Readonly<{
    message: string;
}>;

export function resolveSessionAuthSurfaceState(params: Readonly<{
    endpointStatus: unknown;
    routeHydrationState?: SessionRouteHydrationState | null;
    syncError: {
        message: string;
        kind: 'auth' | 'config' | 'network' | 'server' | 'unknown';
    } | null;
}>): SessionAuthSurfaceState | null {
    if (params.syncError?.kind === 'auth') {
        return { message: params.syncError.message };
    }
    if (params.endpointStatus === 'auth_failed' || (
        params.routeHydrationState?.kind === 'missing'
        && (params.routeHydrationState.cause === 'unauthorized'
            || params.routeHydrationState.cause === 'auth_unavailable')
    )) {
        return { message: createNotAuthenticatedError().message };
    }
    return null;
}
