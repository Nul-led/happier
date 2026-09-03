import { afterEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { MarketplaceSourceRegistryV1 } from '@happier-dev/protocol';

const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (...args: unknown[]) => machineRpcWithServerScopeMock(...args),
}));

describe('machineMarketplaceSources', () => {
    afterEach(() => {
        machineRpcWithServerScopeMock.mockReset();
    });

    it('prefers enabled curated sources over user sources', async () => {
        const { resolvePreferredMachineMarketplaceSource } = await import('./machineMarketplaceSources');

        const registry: MarketplaceSourceRegistryV1 = {
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [
                {
                    id: 'marketplace:user',
                    title: 'User',
                    sourceUrl: 'https://user.example.test/catalog.json',
                    enabled: true,
                    origin: 'user',
                    addedAtMs: 1,
                    updatedAtMs: 1,
                },
                {
                    id: 'marketplace:curated',
                    title: 'Curated',
                    sourceUrl: 'https://curated.example.test/catalog.json',
                    enabled: true,
                    origin: 'curated',
                    addedAtMs: 1,
                    updatedAtMs: 1,
                },
            ],
        };

        expect(resolvePreferredMachineMarketplaceSource(registry)).toMatchObject({
            id: 'marketplace:curated',
            sourceUrl: 'https://curated.example.test/catalog.json',
        });
    });

    it('routes registry reads through the server scoped machine rpc', async () => {
        const { machineMarketplaceSourceRegistryGet } = await import('./machineMarketplaceSources');

        const registry: MarketplaceSourceRegistryV1 = {
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [],
        };
        machineRpcWithServerScopeMock.mockResolvedValueOnce(registry);

        await expect(machineMarketplaceSourceRegistryGet('machine-1', {
            serverId: 'server-a',
            timeoutMs: 2500,
        })).resolves.toEqual(registry);

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            timeoutMs: 2500,
            method: RPC_METHODS.DAEMON_MARKETPLACE_SOURCE_REGISTRY_GET,
            payload: {},
        }));
    });

    it('routes source-scoped mutations through the server scoped machine rpc', async () => {
        const { machineMarketplaceSourceRegistryMutate } = await import('./machineMarketplaceSources');

        const registry: MarketplaceSourceRegistryV1 = {
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [],
        };
        machineRpcWithServerScopeMock.mockImplementationOnce(async (input) => {
            input.onIssued?.();
            return registry;
        });

        const mutation = { kind: 'setEnabled', sourceId: 'marketplace:user', enabled: false } as const;
        await expect(machineMarketplaceSourceRegistryMutate('machine-1', mutation, {
            serverId: 'server-a',
            timeoutMs: 2500,
        })).resolves.toEqual({ status: 'success', registry });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            timeoutMs: 2500,
            method: RPC_METHODS.DAEMON_MARKETPLACE_SOURCE_REGISTRY_MUTATE,
            payload: mutation,
            onIssued: expect.any(Function),
        }));
    });

    it('returns outcomeUnknown only when a source mutation loses its response after issue', async () => {
        const { machineMarketplaceSourceRegistryMutate } = await import('./machineMarketplaceSources');
        const mutation = { kind: 'setEnabled', sourceId: 'marketplace:user', enabled: false } as const;
        machineRpcWithServerScopeMock.mockImplementationOnce(async (input) => {
            input.onIssued?.();
            throw new Error('response lost');
        });

        await expect(machineMarketplaceSourceRegistryMutate('machine-1', mutation, {
            serverId: 'server-a',
        })).resolves.toEqual({ status: 'outcomeUnknown' });

        machineRpcWithServerScopeMock.mockRejectedValueOnce(new Error('not issued'));
        await expect(machineMarketplaceSourceRegistryMutate('machine-1', mutation, {
            serverId: 'server-a',
        })).rejects.toThrow('not issued');
    });

    it('keeps an exact daemon invalid_request definite after issue and treats only malformed settlement as unknown', async () => {
        const { machineMarketplaceSourceRegistryMutate } = await import('./machineMarketplaceSources');
        const mutation = { kind: 'setEnabled', sourceId: 'marketplace:user', enabled: false } as const;
        machineRpcWithServerScopeMock.mockImplementationOnce(async (input) => {
            input.onIssued?.();
            return { ok: false, errorCode: 'invalid_request', error: 'invalid_request' };
        });

        await expect(machineMarketplaceSourceRegistryMutate('machine-1', mutation, {
            serverId: 'server-a',
        })).resolves.toEqual({ status: 'unavailable' });

        machineRpcWithServerScopeMock.mockImplementationOnce(async (input) => {
            input.onIssued?.();
            return { ok: false, errorCode: 'invalid_request' };
        });
        await expect(machineMarketplaceSourceRegistryMutate('machine-1', mutation, {
            serverId: 'server-a',
        })).resolves.toEqual({ status: 'outcomeUnknown' });
    });

    it('rejects an invalid source mutation before issuing the machine RPC', async () => {
        const { machineMarketplaceSourceRegistryMutate } = await import('./machineMarketplaceSources');

        await expect(machineMarketplaceSourceRegistryMutate('machine-1', {
            kind: 'setEnabled',
            sourceId: '',
            enabled: false,
        })).rejects.toThrow();
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
    });

    it('validates marketplace query responses and returns one page with a caller-owned cursor', async () => {
        const { machineMarketplaceIndexQuery } = await import('./machineMarketplaceSources');
        const page = { revision: 7, items: [], nextCursor: 'cursor-2', sources: [], diagnostics: [] };
        machineRpcWithServerScopeMock.mockResolvedValueOnce(page);

        const query = { text: 'browser', cursor: 'cursor-1', limit: 100, filters: {} };
        await expect(machineMarketplaceIndexQuery('machine-1', query, { serverId: 'server-a' })).resolves.toEqual(page);

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-a',
            timeoutMs: undefined,
            method: RPC_METHODS.DAEMON_MARKETPLACE_INDEX_QUERY,
            payload: query,
        });

        machineRpcWithServerScopeMock.mockReset();
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: false, errorCode: 'invalid_request' });
        await expect(machineMarketplaceIndexQuery('machine-1', {
            text: '', cursor: null, limit: 100, filters: {},
        })).rejects.toThrow(/marketplace index/i);
    });
});
