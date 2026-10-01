import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'vite';

const fixtureDirs: string[] = [];
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));

vi.mock('@/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts', async () => {
    const { emptyBundledPluginUiAssetsModule } = await import('@/dev/testkit/mocks/bundledPluginUiAssets');
    return emptyBundledPluginUiAssetsModule;
});

it('supports asset-boundary mock factories that import the shared typed fixture', async () => {
    const inventory = await import('@/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts');
    expect(inventory.BUNDLED_PLUGIN_UI_APP_ARTIFACTS).toEqual([]);
});

it('loads an empty app inventory through the default source-test config without app publication', async () => {
    const server = await createServer({
        root: packageRoot,
        configFile: join(packageRoot, 'vitest.config.ts'),
        server: { middlewareMode: true, watch: null },
    });
    try {
        const importer = join(packageRoot, 'sources/sync/domains/plugins/availability/bundledAppExactArtifactSource.ts');
        const fixturePath = join(packageRoot, 'sources/dev/testkit/mocks/bundledPluginUiAssets.ts');
        for (const id of [
            './generatedBundledPluginUiArtifacts',
            './generatedBundledPluginUiArtifacts.js',
            '@/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts',
            join(packageRoot, 'sources/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts.js'),
        ]) {
            const resolved = await server.pluginContainer.resolveId(id, importer);
            expect(resolved?.id).toBe(fixturePath);
            const inventory = await server.ssrLoadModule(resolved!.id);
            expect(inventory.BUNDLED_PLUGIN_UI_APP_ARTIFACTS).toEqual([]);
        }
    } finally {
        await server.close();
    }
});

afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('resolves the generated JavaScript sibling through the Vite resolver used by Vitest', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'happier-generated-ui-resolution-'));
    fixtureDirs.push(fixtureDir);
    const sourcePath = join(fixtureDir, 'generatedBundledPluginUiArtifacts.js');
    writeFileSync(sourcePath, 'export const BUNDLED_PLUGIN_UI_APP_ARTIFACTS = ["published-fixture"];\n');
    writeFileSync(join(fixtureDir, 'generatedBundledPluginUiArtifacts.d.ts'),
        'export declare const BUNDLED_PLUGIN_UI_APP_ARTIFACTS: readonly unknown[];\n');
    const importer = join(fixtureDir, 'consumer.ts');
    writeFileSync(importer, "import './generatedBundledPluginUiArtifacts';\n");

    const server = await createServer({
        root: packageRoot,
        configFile: join(packageRoot, 'vitest.artifact-cache.config.ts'),
        server: { middlewareMode: true, watch: null },
    });
    try {
        const resolved = await server.pluginContainer.resolveId('./generatedBundledPluginUiArtifacts', importer);
        expect(resolved?.id).toBe(sourcePath);
        const inventory = await server.ssrLoadModule(sourcePath);
        expect(inventory.BUNDLED_PLUGIN_UI_APP_ARTIFACTS).toEqual(['published-fixture']);
    } finally {
        await server.close();
    }
});
