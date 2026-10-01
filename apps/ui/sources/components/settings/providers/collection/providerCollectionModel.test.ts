import { describe, expect, it } from 'vitest';

import {
    createProviderConnectionViewFixture,
    createProviderConnectionsDescribeFixture,
} from '@/dev/testkit';

import { buildProviderCollection, resolveProviderCollectionLandingId } from './providerCollectionModel';

function candidate(overrides: Record<string, unknown>) {
    return {
        v: 1, machineId: 'machine-a', contributionKey: 'plugin/ollama',
        providerName: 'Ollama', endpointTemplateId: 'native',
        normalizedEndpointUrl: 'http://127.0.0.1:11434',
        candidateId: 'discovery-candidate:v1:a',
        evidence: { kind: 'attributed_listener' }, ownership: 'adopted',
        connection: { status: 'enable_default' },
        ...overrides,
    } as never;
}

describe('buildProviderCollection', () => {
    it('lists found servers that are not connections yet, once per contribution', () => {
        const data = createProviderConnectionsDescribeFixture({
            connections: [createProviderConnectionViewFixture({ connectionId: 'pc_a', displayName: 'Acme', providerName: 'Acme' })],
            discoveryCandidates: [
                candidate({ contributionKey: 'plugin/acme', providerName: 'Acme', connection: { status: 'matched', connectionId: 'pc_a' } }),
                candidate({}),
            ],
            localInstallations: [
                { v: 1, machineId: 'machine-a', contributionKey: 'plugin/ollama', providerName: 'Ollama', status: 'installed_not_running', managedStartAvailable: false },
                { v: 1, machineId: 'machine-a', contributionKey: 'plugin/lmstudio', providerName: 'LM Studio', status: 'installed_not_running', managedStartAvailable: true },
            ] as never,
        });
        const collection = buildProviderCollection({ data, query: '', localDiscoveryEnabled: true });

        expect(collection.connections.map((row) => row.connectionId)).toEqual(['pc_a']);
        // The matched Acme server is the Acme connection; the running Ollama stands for its installation.
        expect(collection.found.map((row) => `${row.kind}:${row.title}`)).toEqual([
            'candidate:Ollama',
            'installation:LM Studio',
        ]);
        expect(collection.total).toBe(3);
        expect(buildProviderCollection({ data, query: '', localDiscoveryEnabled: false }).found).toEqual([]);
    });

    it('filters by name while keeping the unfiltered total', () => {
        const data = createProviderConnectionsDescribeFixture({
            connections: [
                createProviderConnectionViewFixture({ connectionId: 'pc_a', displayName: 'Acme', providerName: 'Acme' }),
                createProviderConnectionViewFixture({ connectionId: 'pc_b', displayName: 'Beta', providerName: 'Beta' }),
            ],
        });
        const collection = buildProviderCollection({ data, query: 'bet', localDiscoveryEnabled: true });
        expect(collection.connections.map((row) => row.connectionId)).toEqual(['pc_b']);
        expect(collection.total).toBe(2);
    });
});

describe('resolveProviderCollectionLandingId', () => {
    it('prefers the last visited connection that still exists, else the first, else none', () => {
        const rows = [{ connectionId: 'pc_a' }, { connectionId: 'pc_b' }];
        expect(resolveProviderCollectionLandingId(rows, 'pc_b')).toBe('pc_b');
        expect(resolveProviderCollectionLandingId(rows, 'pc_gone')).toBe('pc_a');
        expect(resolveProviderCollectionLandingId([], 'pc_a')).toBeNull();
    });
});
