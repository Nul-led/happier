import * as React from 'react';

import {
    accountDirectoryAuthClient,
    type AccountDirectoryAuthMethodDiscovery,
} from '@/auth/accountDirectory/accountDirectoryAuthClient';
import {
    resolveSelectedAccountServiceEndpoint,
    subscribeAccountServiceEndpoint,
    type AccountServiceEndpointV1,
} from '@/sync/domains/server/serverProfiles';

export type AccountServiceEntryOptions = Readonly<{
    /** The selected sign-in service. Exists before any Home profile, focused Home, or Sync runtime. */
    endpoint: AccountServiceEndpointV1;
    /**
     * `unsupported` identifies an ordinary Home without Account Directory. `unavailable` covers
     * an unreachable endpoint, stable-identity mismatch, or malformed advertisement. Welcome
     * keeps the selected service authoritative in either case and presents recovery actions.
     */
    status: 'loading' | 'ready' | 'unavailable' | 'unsupported';
    /** The service's own advertised methods. Non-null only while `status` is `ready`. */
    discovery: AccountDirectoryAuthMethodDiscovery | null;
    /** Re-runs discovery against this exact selected endpoint. */
    retry: () => void;
}>;

/**
 * Advertised authentication methods of the selected sign-in service, read straight from that exact
 * endpoint through Lane 01's explicit endpoint boundary.
 *
 * This deliberately does not consult `useAuthEntryOptions`, the focused Home, or any Home runtime:
 * a focused Home must not be able to retarget sign-in-service discovery. Discovery is a plain
 * capability probe — it creates no `ServerProfile`, group member, Sync runtime, or Socket.IO target,
 * and it never writes a credential.
 */
export function useAccountServiceEntryOptions(): AccountServiceEntryOptions {
    const endpoint = React.useSyncExternalStore(
        (listener) => subscribeAccountServiceEndpoint(() => listener()),
        resolveSelectedAccountServiceEndpoint,
        resolveSelectedAccountServiceEndpoint,
    );
    const endpointUrl = endpoint.url;
    const expectedServerIdentityId = endpoint.serverIdentityId ?? null;
    const [resolved, setResolved] = React.useState<Readonly<{
        status: 'loading' | 'ready' | 'unavailable' | 'unsupported';
        discovery: AccountDirectoryAuthMethodDiscovery | null;
    }>>({ status: 'loading', discovery: null });
    const [retryGeneration, setRetryGeneration] = React.useState(0);

    React.useEffect(() => {
        let cancelled = false;
        setResolved({ status: 'loading', discovery: null });
        void (async () => {
            try {
                const discovery = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                    endpointUrl,
                    expectedServerIdentityId,
                });
                if (cancelled) return;
                setResolved(discovery.kind === 'supported_account_service'
                    ? { status: 'ready', discovery }
                    : discovery.kind === 'not_account_service'
                        ? { status: 'unsupported', discovery: null }
                        : { status: 'unavailable', discovery: null });
            } catch {
                if (!cancelled) setResolved({ status: 'unavailable', discovery: null });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [endpointUrl, expectedServerIdentityId, retryGeneration]);

    const retry = React.useCallback(() => setRetryGeneration((generation) => generation + 1), []);

    return React.useMemo(() => ({
        endpoint,
        status: resolved.status,
        discovery: resolved.discovery,
        retry,
    }), [endpoint, resolved, retry]);
}
