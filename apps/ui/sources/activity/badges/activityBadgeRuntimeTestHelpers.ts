import { vi } from 'vitest';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { createAccountTokenForTests } from '@/dev/testkit/harness/homeGovernanceHarness';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';

import { resolveBadgeHomeAccountId, resolveBadgeHomeServerUrl } from './activityBadgeRuntimeHomeFixtures';

/**
 * Saves the badge corpus's Homes through the real Home owner and answers for each Home's Account
 * at the one boundary that genuinely leaves this process: the device credential store.
 *
 * **The rule this helper exists to keep.** `@/sync/domains/server/serverProfiles` and
 * `@/auth/storage/tokenStorage` are internal domain owners, not system boundaries, so neither is
 * ever `vi.mock`ed from this corridor. Two separate reasons:
 *
 * 1. A partial module mock of an internal owner asserts against a hand-written subset of it. The
 *    badge reads a Home through `resolveServerCredentialAccountScope`, which composes
 *    `getServerProfileById` with `TokenStorage.getCredentialsForServerUrl` and the real token
 *    decoder; a stub of either half can only prove the stub.
 * 2. A `vi.mock` factory for one of these modules deadlocks this corridor's suites outright. Both
 *    suites statically import `@/dev/testkit`, whose barrel re-exports
 *    `harness/homeGovernanceHarness`, which value-imports `TokenStorage`. A hoisted
 *    `vi.mock('@/auth/storage/tokenStorage', …)` therefore runs its factory *while that harness
 *    module is still evaluating*, and the factory's own `await import(harness)` — for
 *    `createAccountTokenForTests` — waits on that in-flight evaluation forever. The file then never
 *    finishes importing, so no case is ever collected and no test timeout applies, because Vitest
 *    timeouts do not cover module evaluation. Measured: the identical factory minus the harness
 *    import settles in 1.5 s; `importOriginal` is not what breaks it.
 *
 * So: drive the real owners, and keep `vi.mock` for genuine boundaries only — the platform badge
 * channels, the network client, `react-native`, and the storage adapter below.
 */
export async function installBadgeHomeIdentities(serverIds: readonly string[]): Promise<void> {
    const tokensByServerUrl = new Map<string, string>();
    for (const serverId of serverIds) {
        const serverUrl = resolveBadgeHomeServerUrl(serverId);
        const profile = await upsertServerProfile({ serverUrl, name: serverId });
        if (profile.id !== serverId) {
            // The suites address Homes by id; a derived id that drifted would silently move every
            // per-Home projection to a Home the fixtures never wrote settings for.
            throw new Error(`badge Home fixture: ${serverUrl} was saved as "${profile.id}", not "${serverId}"`);
        }
        tokensByServerUrl.set(profile.serverUrl, createAccountTokenForTests(resolveBadgeHomeAccountId(serverId)));
    }

    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockImplementation(async (serverUrl: string) => {
        const token = tokensByServerUrl.get(serverUrl) ?? null;
        return token ? { token } : null;
    });
}

type ActivityBadgeRuntimeModuleFactory = () => unknown | Promise<unknown>;
type ActivityBadgeRuntimeImportOriginal = <T = unknown>() => Promise<T>;
type ActivityBadgeRuntimeStorageModuleFactory = (
    importOriginal: ActivityBadgeRuntimeImportOriginal,
) => unknown | Promise<unknown>;

type InstallActivityBadgeRuntimeCommonModuleMocksOptions = Readonly<{
    reactNative?: ActivityBadgeRuntimeModuleFactory;
    storage?: ActivityBadgeRuntimeStorageModuleFactory;
}>;

const activityBadgeRuntimeModuleState = vi.hoisted(() => ({
    options: {
        reactNative: undefined as ActivityBadgeRuntimeModuleFactory | undefined,
        storage: undefined as ActivityBadgeRuntimeStorageModuleFactory | undefined,
    },
}));

export function installActivityBadgeRuntimeCommonModuleMocks(
    options: InstallActivityBadgeRuntimeCommonModuleMocksOptions,
): void {
    activityBadgeRuntimeModuleState.options = {
        reactNative: options.reactNative,
        storage: options.storage,
    };

    vi.mock('react-native', async () => {
        const activeOptions = activityBadgeRuntimeModuleState.options;
        if (activeOptions.reactNative) {
            return await activeOptions.reactNative();
        }

        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock();
    });

    vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
        const activeOptions = activityBadgeRuntimeModuleState.options;
        if (activeOptions.storage) {
            return await activeOptions.storage(importOriginal);
        }

        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({});
    });
}
