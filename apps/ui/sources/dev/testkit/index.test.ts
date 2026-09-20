import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('UI testkit barrel', () => {
    it('does not re-export the plugin surface fixture that loads the text module', async () => {
        const barrelSource = await readFile(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

        expect(barrelSource).not.toContain("./fixtures/pluginSurfaceContextFixture");
    });

    it('does not re-export the agent catalog fixture that loads the sync runtime', async () => {
        // `fixtures/agentCatalogFixtures` reaches
        // `@/sync/runtime/orchestration/connectionManager` through
        // `agentCatalogProjection` -> `registryUiBehavior` ->
        // `agentUiBehaviorProjection` -> `activeServerAccountScope`. Re-exported
        // here it bound the real transports and froze the applied active Home on
        // the first import of any barrel consumer, so unrelated Teams, ops and
        // Home Administration suites rendered against the real network. It was
        // the sole barrel edge to that graph; consumers import it by its own path.
        const barrelSource = await readFile(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

        expect(barrelSource).not.toContain("./fixtures/agentCatalogFixtures");
    });
});
