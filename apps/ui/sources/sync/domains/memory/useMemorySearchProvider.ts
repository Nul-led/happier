import * as React from 'react';

import { HomeSearchCapabilitiesSchema } from '@happier-dev/protocol';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { useServerFeaturesRuntimeSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';

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
 * Provider selection authority: Lane 03 classifies a profile as
 * `desktop-personal-home` only after its plaintext-only policy is verified.
 * That durable classification keeps search Home-owned even while the optional
 * capability is indexing, unavailable, or absent. Other profiles keep daemon
 * search; the capability refines Home readiness and query availability only.
 */
export function resolveMemorySearchProvider(input: Readonly<{
    profileSource: string | null | undefined;
}>): MemorySearchProviderId {
    if (input.profileSource !== 'desktop-personal-home') return 'daemon';
    return 'home';
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
    const activeServer = useActiveServerSnapshot();
    const serverProfilesGeneration = useServerProfilesGeneration();
    const profile = activeServer.serverId ? getServerProfileById(activeServer.serverId) : null;
    const provider = resolveMemorySearchProvider({ profileSource: profile?.source });
    const featuresSnapshot = useServerFeaturesRuntimeSnapshot({ enabled: provider === 'home' });

    return React.useMemo(() => {
        if (provider === 'daemon') {
            return { provider, homeReadiness: null, queryAvailable: true };
        }
        const homeReadiness = resolveHomeMemorySearchReadiness(
            featuresSnapshot.status === 'ready'
                ? featuresSnapshot.features.capabilities.homeSearch
                : undefined,
        );
        return {
            provider,
            homeReadiness,
            queryAvailable: homeReadiness === 'ready',
        };
        // `serverProfilesGeneration` re-reads the persisted profile store when profiles change.
    }, [provider, serverProfilesGeneration, featuresSnapshot]);
}
