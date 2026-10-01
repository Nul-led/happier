import { afterEach, expect, it, vi } from 'vitest';

import { readSpawnSessionRpcTimeoutMsFromEnv } from './spawnSessionRpcTimeout';

afterEach(() => vi.unstubAllEnvs());

it('keeps the outer Session spawn wait beyond webhook and first-turn admission', () => {
    vi.stubEnv('EXPO_PUBLIC_HAPPIER_SPAWN_SESSION_RPC_TIMEOUT_MS', '');
    // The daemon may spend five minutes on webhook readiness and one minute
    // admitting the first Message before the same RPC settles.
    expect(readSpawnSessionRpcTimeoutMsFromEnv()).toBeGreaterThan(6 * 60_000);
});
