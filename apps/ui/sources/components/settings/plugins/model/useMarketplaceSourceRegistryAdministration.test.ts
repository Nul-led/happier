import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceSourceRegistryV1 } from '@happier-dev/protocol/marketplace';

import { act } from 'react-test-renderer';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';
import type { FreshMachineAdministrationExecutionTargetV1 } from '@/sync/domains/machines/administration/useTargetSelection';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    mutate: vi.fn(),
}));

vi.mock('@/sync/ops/machineMarketplaceSources', async () => {
    const actual = await vi.importActual<typeof import('@/sync/ops/machineMarketplaceSources')>(
        '@/sync/ops/machineMarketplaceSources',
    );
    return {
        ...actual,
        machineMarketplaceSourceRegistryGet: mocks.get,
        machineMarketplaceSourceRegistryMutate: mocks.mutate,
    };
});

import { useMarketplaceSourceRegistryAdministration } from './useMarketplaceSourceRegistryAdministration';

function createRegistry(sourceId: string): MarketplaceSourceRegistryV1 {
    return {
        t: 'happier_marketplace_source_registry_v1',
        schemaVersion: 1,
        sources: [{
            id: sourceId,
            title: sourceId,
            sourceUrl: `https://${sourceId}.example.test/index.json`,
            enabled: true,
            origin: 'user',
            addedAtMs: 1,
            updatedAtMs: 1,
        }],
    };
}

function createExecutionTarget(machineId: string): FreshMachineAdministrationExecutionTargetV1 {
    const target = { serverIdentityId: 'portable-server-a', machineId };
    return {
        kind: 'resolved',
        target,
        serverId: 'server-a',
        profile: {
            id: 'server-a',
            name: 'Server A',
            serverUrl: 'https://server-a.example.test',
            serverIdentityId: target.serverIdentityId,
            createdAt: 1,
            updatedAt: 1,
            lastUsedAt: 1,
        },
        machine: {
            id: machineId,
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: null,
            metadataVersion: 0,
            daemonState: null,
            daemonStateVersion: 0,
        },
    } as FreshMachineAdministrationExecutionTargetV1;
}

type HookProps = Readonly<{ scopeKey: string; executionTarget: FreshMachineAdministrationExecutionTargetV1 }>;

/**
 * A stable resolver: the owner treats it as an effect input, so an inline
 * closure would re-issue the read on every render instead of on a real change.
 */
const resolveCurrentExecutionTarget = (
    expected: FreshMachineAdministrationExecutionTargetV1 | null,
): FreshMachineAdministrationExecutionTargetV1 | null => expected;

async function renderOwner(props: HookProps) {
    return await renderHook(
        (current: HookProps) => useMarketplaceSourceRegistryAdministration({
            scopeKey: current.scopeKey,
            enabled: true,
            executionTarget: current.executionTarget,
            resolveCurrentExecutionTarget,
        }),
        { initialProps: props },
    );
}

describe('useMarketplaceSourceRegistryAdministration', () => {
    beforeEach(() => {
        mocks.get.mockReset();
        mocks.mutate.mockReset();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('keeps the last known registry visible when a refresh of the same machine fails', async () => {
        const registry = createRegistry('marketplace:user');
        mocks.get.mockResolvedValueOnce(registry).mockRejectedValueOnce(new Error('machine unreachable'));
        const target = createExecutionTarget('machine-a');
        const hook = await renderOwner({ scopeKey: 'machine-a', executionTarget: target });
        expect(hook.getCurrent().registry).toEqual(registry);

        // One initial read per stable target: a rerender carrying the same
        // target and resolver is presentation only and must not re-issue the
        // registry read; only a real target, scope, freshness, or refresh
        // change may.
        await hook.rerender({ scopeKey: 'machine-a', executionTarget: target });
        expect(mocks.get).toHaveBeenCalledTimes(1);

        await act(async () => { hook.getCurrent().refresh(); });
        await flushHookEffects();
        const afterFailure = hook.getCurrent();

        // The sources this machine has configured did not change because one
        // read failed; dropping them would present "no sources" as truth and
        // disable every action the reader came here for.
        expect(afterFailure.registry).toEqual(registry);
        expect(afterFailure.loadError).toBe(true);
        expect(afterFailure.loading).toBe(false);
    });

    it('drops the registry when the selected machine changes so the next one cannot inherit it', async () => {
        mocks.get
            .mockResolvedValueOnce(createRegistry('marketplace:a'))
            .mockRejectedValueOnce(new Error('machine unreachable'));
        const hook = await renderOwner({
            scopeKey: 'machine-a',
            executionTarget: createExecutionTarget('machine-a'),
        });
        expect(hook.getCurrent().registry).not.toBeNull();

        await hook.rerender({ scopeKey: 'machine-b', executionTarget: createExecutionTarget('machine-b') });

        expect(hook.getCurrent().registry).toBeNull();
        expect(hook.getCurrent().loadError).toBe(true);
    });

    it('sends concurrent edits as independent mutations and keeps the daemon-combined result', async () => {
        const initial = createRegistry('marketplace:existing');
        const afterAlpha = {
            ...initial,
            sources: [...initial.sources, createRegistry('marketplace:alpha').sources[0]!],
        };
        const afterBoth = {
            ...afterAlpha,
            sources: [...afterAlpha.sources, createRegistry('marketplace:beta').sources[0]!],
        };
        mocks.get.mockResolvedValue(initial);
        mocks.mutate
            .mockResolvedValueOnce({ status: 'success', registry: afterAlpha })
            .mockResolvedValueOnce({ status: 'success', registry: afterBoth });
        const hook = await renderOwner({ scopeKey: 'machine-a', executionTarget: createExecutionTarget('machine-a') });

        await act(async () => {
            await Promise.all([
                hook.getCurrent().upsertSource({ sourceUrl: 'https://alpha.example.test/index.json', title: 'Alpha', origin: 'user' }),
                hook.getCurrent().upsertSource({ sourceUrl: 'https://beta.example.test/index.json', title: 'Beta', origin: 'user' }),
            ]);
        });

        expect(mocks.mutate).toHaveBeenNthCalledWith(1, 'machine-a', {
            kind: 'upsert',
            input: { sourceUrl: 'https://alpha.example.test/index.json', title: 'Alpha', origin: 'user' },
        }, { serverId: 'server-a' });
        expect(mocks.mutate).toHaveBeenNthCalledWith(2, 'machine-a', {
            kind: 'upsert',
            input: { sourceUrl: 'https://beta.example.test/index.json', title: 'Beta', origin: 'user' },
        }, { serverId: 'server-a' });
        expect(hook.getCurrent().registry).toEqual(afterBoth);
    });

    it('does not apply a completed mutation after the selected machine changes', async () => {
        let finishMutation: (registry: MarketplaceSourceRegistryV1) => void = () => {
            throw new Error('Mutation resolver was not initialized');
        };
        const mutation = new Promise<{ status: 'success'; registry: MarketplaceSourceRegistryV1 }>((resolve) => {
            finishMutation = (registry) => resolve({ status: 'success', registry });
        });
        mocks.get.mockResolvedValueOnce(createRegistry('marketplace:a')).mockResolvedValueOnce(createRegistry('marketplace:b'));
        mocks.mutate.mockReturnValueOnce(mutation);
        const hook = await renderOwner({ scopeKey: 'machine-a', executionTarget: createExecutionTarget('machine-a') });

        const pending = hook.getCurrent().setSourceEnabled('marketplace:a', false);
        await hook.rerender({ scopeKey: 'machine-b', executionTarget: createExecutionTarget('machine-b') });
        finishMutation(createRegistry('marketplace:stale-a'));
        await act(async () => { await pending; });

        expect(hook.getCurrent().registry).toEqual(createRegistry('marketplace:b'));
    });

    it('refreshes the original target and returns outcomeUnknown after an issued mutation loses its response', async () => {
        const initial = createRegistry('marketplace:a');
        const reconciled = createRegistry('marketplace:reconciled-a');
        mocks.get.mockResolvedValueOnce(initial).mockResolvedValueOnce(reconciled);
        mocks.mutate.mockResolvedValueOnce({ status: 'outcomeUnknown' });
        const hook = await renderOwner({ scopeKey: 'machine-a', executionTarget: createExecutionTarget('machine-a') });

        let settlement: unknown;
        await act(async () => {
            settlement = await hook.getCurrent().setSourceEnabled('marketplace:a', false);
        });
        await flushHookEffects();

        expect(settlement).toEqual({ status: 'outcomeUnknown' });
        expect(mocks.get).toHaveBeenCalledTimes(2);
        expect(mocks.get).toHaveBeenLastCalledWith('machine-a', { serverId: 'server-a' });
        expect(hook.getCurrent().registry).toEqual(reconciled);
    });

    it('returns a definite unavailable settlement without reconciling after daemon validation rejects the mutation', async () => {
        const initial = createRegistry('marketplace:a');
        mocks.get.mockResolvedValueOnce(initial);
        mocks.mutate.mockResolvedValueOnce({ status: 'unavailable' });
        const hook = await renderOwner({ scopeKey: 'machine-a', executionTarget: createExecutionTarget('machine-a') });

        let settlement: unknown;
        await act(async () => {
            settlement = await hook.getCurrent().setSourceEnabled('marketplace:a', false);
        });

        expect(settlement).toEqual({ status: 'unavailable' });
        expect(mocks.get).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().registry).toEqual(initial);
    });
});
