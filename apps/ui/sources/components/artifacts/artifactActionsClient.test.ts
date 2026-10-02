import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderHook } from '@/dev/testkit';
import { serveActionHomes } from '@/dev/testkit/harness/actionHomesHttpHarness';
import { invalidateAccountEncryptionModeCache } from '@/sync/api/account/apiAccountEncryptionMode';
import { retireActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { getStorage } from '@/sync/domains/state/storage';
import { useArtifactStorageUsage } from './artifactActionsClient';

const initialState = getStorage().getState();
let disposeHome: (() => void) | undefined;
afterEach(() => {
    disposeHome?.();
    disposeHome = undefined;
    retireActiveServerAccountScopeLifetime();
    invalidateAccountEncryptionModeCache();
    getStorage().setState(initialState, true);
    vi.restoreAllMocks();
});

describe('Artifacts storage meter', () => {
    it('never carries another Home\'s budget into the active Account when its usage read fails', async () => {
        const usage = { usedBytes: 321, limitBytes: 1000, documentLimitBytes: null, revisionRetentionCount: 10 };
        const served = await serveActionHomes({
            homes: [
                { key: 'first', serverUrl: 'https://artifact-meter-first.test', accountId: 'first-owner' },
                { key: 'second', serverUrl: 'https://artifact-meter-second.test', accountId: 'second-owner' },
            ],
            route: (request) => request.path === '/v1/artifacts/storage/usage'
                ? request.home === 'first' ? Response.json(usage) : Response.json({ error: 'unavailable' }, { status: 503 })
                : undefined,
        });
        disposeHome = served.dispose;
        const firstScope = { serverId: served.homes.first!.id, accountId: 'first-owner' };
        const secondScope = { serverId: served.homes.second!.id, accountId: 'second-owner' };
        getStorage().setState({ profileScope: firstScope, settingsScope: firstScope });
        const hook = await renderHook(useArtifactStorageUsage);
        await flushHookEffects();
        expect(hook.getCurrent()).toEqual(usage);

        await act(async () => { getStorage().setState({ profileScope: secondScope, settingsScope: secondScope }); });
        await hook.rerender();
        await flushHookEffects();
        expect(hook.getCurrent()).toBeNull();
        expect(served.requests.filter((request) => request.path === '/v1/artifacts/storage/usage')
            .map((request) => [request.home, request.accountId])).toEqual([
                ['first', 'first-owner'], ['second', 'second-owner'],
            ]);
        await hook.unmount();
    });
});
