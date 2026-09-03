import { describe, expect, it, vi } from 'vitest';

const agentsPackageState = vi.hoisted(() => ({
    definitions: [
        { id: 'claude' },
        { id: 'codex' },
        { id: 'gemini' },
    ] as const,
}));

vi.mock('@happier-dev/agents', async (importOriginal) => ({
    ...await importOriginal<typeof import('@happier-dev/agents')>(),
    getAllAgentCatalogDefinitions: () => agentsPackageState.definitions,
}));

describe('agentUniverse', () => {
    it('canonicalizes a bundled Agent id to its qualified Agent target', async () => {
        vi.resetModules();
        const { buildAgentUniverseBackendTargetKey } = await import('./agentUniverse');

        expect(buildAgentUniverseBackendTargetKey('antigravity'))
            .toBe('agent:happier.agent.antigravity/antigravity');
    });

    it('reads the complete universe from the canonical Agent catalog', async () => {
        vi.resetModules();
        const { listAgentUniverseIds } = await import('./agentUniverse');

        expect(listAgentUniverseIds()).toEqual(['claude', 'codex', 'gemini']);
    });
});
