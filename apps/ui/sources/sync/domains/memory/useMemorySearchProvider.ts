import * as React from 'react';

import { HomeSearchCapabilitiesSchema } from '@happier-dev/protocol';

import { useServerFeaturesRuntimeSnapshot } from '@/sync/domains/features/featureDecisionRuntime';

export type MemorySearchProviderId = 'home' | 'daemon';

/**
 * Readiness of the Personal Home search index according to the optional server
 * `capabilities.homeSearch` advertisement. `unknown` covers missing (older
 * server) and malformed advertisements; the typed route result remains the
 * authority for actual request outcomes.
 */
export type HomeMemorySearchReadiness = 'ready' | 'indexing' | 'unavailable' | 'unknown';

export type MemorySearchProvider = Readonly<{
    provider: MemorySearchProviderId;
    homeReadiness: HomeMemorySearchReadiness | null;
    queryAvailable: boolean;
}>;

/**
 * Provider selection is a functional active-Home decision. The strict server
 * capability identifies the actual search provider even when the profile was
 * adopted through QR, Account Directory, or manual configuration. Missing or
 * unsupported capability shapes safely retain the daemon provider.
 */
export function resolveMemorySearchProvider(input: Readonly<{
    capability: unknown;
}>): MemorySearchProviderId {
    const parsed = HomeSearchCapabilitiesSchema.safeParse(input.capability);
    return parsed.success && parsed.data.provider === 'home' ? 'home' : 'daemon';
}

export function resolveHomeMemorySearchReadiness(capability: unknown): HomeMemorySearchReadiness {
    const parsed = HomeSearchCapabilitiesSchema.safeParse(capability);
    if (!parsed.success) return 'unknown';
    if (parsed.data.reason === 'indexing') return 'indexing';
    if (parsed.data.reason === 'index_unavailable') return 'unavailable';
    if (parsed.data.enabled && parsed.data.provider === 'home') return 'ready';
    return 'unknown';
}

export function useMemorySearchProvider(): MemorySearchProvider {
    // This fetch must be independent of profile provenance: its result is the
    // authority used to choose the provider.
    const featuresSnapshot = useServerFeaturesRuntimeSnapshot({ enabled: true });

    return React.useMemo(() => {
        const capability = featuresSnapshot.status === 'ready'
            ? featuresSnapshot.features.capabilities.homeSearch
            : undefined;
        const provider = resolveMemorySearchProvider({ capability });
        if (provider === 'daemon') {
            return { provider, homeReadiness: null, queryAvailable: true };
        }
        const homeReadiness = resolveHomeMemorySearchReadiness(capability);
        return {
            provider,
            homeReadiness,
            queryAvailable: homeReadiness === 'ready',
        };
    }, [featuresSnapshot]);
}
