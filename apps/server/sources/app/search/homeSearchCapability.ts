import { resolveLightDataDir } from '@/flavors/light/env';

export type HomeSearchCapability = Readonly<{
    enabled: boolean;
    provider: 'home' | 'daemon' | null;
    reason?: 'non_plain_home' | 'index_unavailable' | 'indexing';
}>;

/** Plain-at-rest Homes index plaintext transcripts; encrypted content stays with client/daemon search. */
export function isPlainHomeStoragePolicy(storagePolicy: string | undefined): boolean {
    return storagePolicy === 'plaintext_only' || storagePolicy === 'plain';
}

/** Canonical production admission for the server-light Home-local search route/lifecycle. */
export function resolveHomeSearchRuntimeConfig(env: NodeJS.ProcessEnv): Readonly<{
    dataDir: string;
    storagePolicy: string;
}> | null {
    const storagePolicy = String(env.HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY ?? env.HAPPY_FEATURE_ENCRYPTION__STORAGE_POLICY ?? '');
    if ((env.HAPPIER_SERVER_FLAVOR ?? env.HAPPY_SERVER_FLAVOR) !== 'light'
        || (env.HAPPIER_DB_PROVIDER ?? env.HAPPY_DB_PROVIDER) !== 'sqlite'
        || (env.HAPPIER_FILES_BACKEND ?? env.HAPPY_FILES_BACKEND) !== 'local'
        || !isPlainHomeStoragePolicy(storagePolicy)
    ) return null;
    return { dataDir: resolveLightDataDir(env), storagePolicy };
}

/**
 * Search is advertised only after the plain Home index is open, usable, and its initial
 * reconciliation has completed. While that reconciliation is still running the capability
 * reports `indexing` instead of ready, and daemon remains the provider for non-plain Homes.
 */
export function resolveHomeSearchCapability(input: Readonly<{
    storagePolicy: string | undefined;
    indexReady: boolean;
    indexing?: boolean;
}>): HomeSearchCapability {
    if (!isPlainHomeStoragePolicy(input.storagePolicy)) {
        return { enabled: false, provider: 'daemon', reason: 'non_plain_home' };
    }
    if (input.indexing) return { enabled: false, provider: 'home', reason: 'indexing' };
    if (!input.indexReady) return { enabled: false, provider: 'home', reason: 'index_unavailable' };
    return { enabled: true, provider: 'home' };
}
