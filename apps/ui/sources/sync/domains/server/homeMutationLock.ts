import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';

const HOME_MUTATION_LOCK_PREFIX = 'happier:server-state-v1';
const HOME_MUTATION_AUTHORITY = Symbol('HomeMutationAuthority');

export type HomeMutationAuthority = {
    readonly [HOME_MUTATION_AUTHORITY]: true;
    active: boolean;
};

function isWebRuntime(): boolean {
    return (typeof window !== 'undefined' && typeof document !== 'undefined')
        || (typeof navigator !== 'undefined' && navigator.locks !== undefined);
}

function lockName(): string {
    return `${HOME_MUTATION_LOCK_PREFIX}:${scopedStorageId('server-profiles', readStorageScopeFromEnv())}`;
}

function isActiveAuthority(authority: HomeMutationAuthority | undefined): boolean {
    return authority?.[HOME_MUTATION_AUTHORITY] === true && authority.active;
}

/**
 * One device-local Home mutation authority shared by profile state and Home
 * credential layouts. Browser tabs serialize through the existing Web Lock;
 * a live authority may be passed through a composed transaction to avoid a
 * nested request for that non-reentrant lock.
 */
export async function withHomeMutationAuthority<T>(
    authority: HomeMutationAuthority | undefined,
    mutate: (authority: HomeMutationAuthority) => T | Promise<T>,
): Promise<T> {
    if (isActiveAuthority(authority)) return await mutate(authority!);

    const run = async (): Promise<T> => {
        const owned = {
            [HOME_MUTATION_AUTHORITY]: true as const,
            active: true,
        };
        try {
            return await mutate(owned);
        } finally {
            owned.active = false;
        }
    };

    if (!isWebRuntime()) return await run();
    const lockManager = typeof navigator === 'undefined' ? null : navigator.locks ?? null;
    if (!lockManager) throw new Error('Browser storage locking is unavailable');
    return await lockManager.request(lockName(), run);
}
