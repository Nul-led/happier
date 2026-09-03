// Contract for the A7.3/A7.4 loaded production-carrier page seam.
//
// The seam's real assertion — that the emitted Metro graph contains the
// production owners — needs a full web build and therefore lives in
// `runProductionCarrierPageSeam.mjs`, where one runs. These are the two cheap
// checks that build cannot make about itself:
//
//   1. the builder bundles with the app's OWN Metro config object, so the page
//      resolves `@/...`, `react-native`, and `@happier-dev/*` exactly as a
//      production web export does; and
//   2. every owner path the graph check looks for is a real file that really
//      exports the symbol the page calls — otherwise the graph check could pass
//      vacuously against a stale or misspelled path.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const toolsIrohDir = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(toolsIrohDir, '..', '..');

/**
 * The production entry points the page calls, and the owner file each must come
 * from. `browserIrohHomeCarrierOwner` is the production singleton entry to
 * `createBrowserIrohHomeCarrierOwner`: it is the exact call the app makes, and
 * it takes its host decision and worker base from the real owners rather than
 * anything a proof could inject.
 */
const PRODUCTION_ENTRY_POINTS = [
    {
        symbol: 'browserIrohHomeCarrierOwner',
        sourceFile: 'sources/sync/runtime/browserIroh/homeCarrier/browserHomeCarrierRuntime.ts',
    },
    { symbol: 'createServerFetchAtEndpoint', sourceFile: 'sources/sync/http/client.ts' },
    {
        symbol: 'createSyncSocketTransport',
        sourceFile: 'sources/sync/api/session/connection/createSyncSocketTransport.ts',
    },
    {
        symbol: 'acquireBrowserMachineCarrierStreamLease',
        sourceFile: 'sources/sync/domains/transfers/runtime/transferRuntime/plumbing/machineCarrierBrowserStream.ts',
    },
];

test('the seam builds with the app\'s own Metro config, not a proof-local resolver', async () => {
    const builder = await import(resolve(toolsIrohDir, 'buildProductionProofPageBundle.mjs'));
    assert.equal(builder.PRODUCTION_PROOF_PAGE_METRO_CONFIG, resolve(uiDir, 'metro.config.js'));

    const canonical = createRequire(import.meta.url)(resolve(uiDir, 'metro.config.js'));
    const loaded = await builder.loadProductionProofPageMetroConfig();
    assert.equal(loaded.projectRoot, uiDir);
    assert.equal(
        loaded.resolver.resolveRequest,
        canonical.resolver.resolveRequest,
        'the builder must bundle with the app config resolver, not a proof-local one',
    );
    assert.deepEqual(loaded.resolver.blockList, canonical.resolver.blockList);
});

/**
 * The page a real Chromium has to download, parse and execute must be the
 * PRODUCTION web build, and must not also carry its own source map.
 *
 * Two properties of the build owner's options decide whether the page is
 * loadable at all, and neither is visible from the page's own source:
 *
 *   1. `dev: false` and `minify: true` — the configuration a production web
 *      export uses. Unminified, this page's real graph is ~94 MB of script
 *      Chromium has to parse before any observation can be made.
 *   2. the source map is a sibling file, never inlined. Metro decides this by
 *      `inlineSourceMap: sourceMap && !sourceMapUrl`
 *      (`metro/src/index.flow.js`), so asking for a map WITHOUT naming a URL
 *      appends the whole map to the bundle as a base64 data URI. On the real
 *      graph that map is ~157 MB, which becomes ~210 MB of base64 — a 304 MB
 *      page that cannot finish loading inside any sane navigation budget, while
 *      the separate `.map` file the graph check reads is written either way.
 *
 * A leaf entry decides both: they are properties of the options the build owner
 * passes, not of how large the graph happens to be. The minify check compares
 * the default build against the same entry built with `minify: false`, so a
 * default that quietly stopped minifying fails here rather than in a 30-second
 * navigation timeout no one can attribute.
 */
test('the built page is the production web build, with its source map beside it', async () => {
    const { buildProductionProofPageBundle } = await import(resolve(toolsIrohDir, 'buildProductionProofPageBundle.mjs'));
    const outputRoot = mkdtempSync(join(tmpdir(), 'happier-proof-page-config-'));
    const leafEntry = resolve(uiDir, 'sources/sync/runtime/connectivity/resolveSocketErrorClassification.ts');
    try {
        const built = await buildProductionProofPageBundle({
            entryFile: leafEntry,
            outFile: join(outputRoot, 'leaf.js'),
        });

        const bundle = readFileSync(built.bundleFile, 'utf8');
        assert.equal(
            /sourceMappingURL=data:/u.test(bundle),
            false,
            'the bundle must not embed its own source map: a real page has to download and parse every byte of it',
        );

        // `__DEV__` is Metro's own record of which configuration produced the
        // bundle, written into its prelude.
        assert.match(
            bundle.slice(0, 4_096),
            /__DEV__\s*=\s*(?:false|!1)/u,
            'the page must be built with the production (dev: false) configuration',
        );

        // The graph check still has a map to read, and it still describes the
        // module the entry really pulled in.
        assert.ok(existsSync(built.sourceMapFile), 'the separate source map file must still be written');
        assert.ok(statSync(built.sourceMapFile).size > 0, 'the separate source map file must not be empty');
        assert.ok(
            built.graphFiles.some((file) => file.replace(/\\/gu, '/')
                .endsWith('sources/sync/runtime/connectivity/resolveSocketErrorClassification.ts')),
            'the emitted graph must still name the entry the build was given',
        );

        const unminified = await buildProductionProofPageBundle({
            entryFile: leafEntry,
            outFile: join(outputRoot, 'leaf-unminified.js'),
            minify: false,
        });
        assert.ok(
            statSync(built.bundleFile).size < statSync(unminified.bundleFile).size,
            'the default build must be minified: it was not smaller than the same entry built with minify: false',
        );
    } finally {
        rmSync(outputRoot, { recursive: true, force: true });
    }
});

test('every owner the graph check looks for is a real file exporting what the page calls', async () => {
    const { REQUIRED_GRAPH_OWNERS } = await import(resolve(toolsIrohDir, 'runProductionCarrierPageSeam.mjs'));
    for (const owner of REQUIRED_GRAPH_OWNERS) {
        assert.ok(existsSync(resolve(uiDir, owner)), `${owner} does not exist; the graph check would be vacuous`);
    }
    for (const entry of PRODUCTION_ENTRY_POINTS) {
        assert.ok(
            REQUIRED_GRAPH_OWNERS.includes(entry.sourceFile),
            `${entry.sourceFile} must be one of the owners the graph check requires`,
        );
        assert.match(
            readFileSync(resolve(uiDir, entry.sourceFile), 'utf8'),
            new RegExp(`export\\s+(?:async\\s+)?function\\s+${entry.symbol}\\b`, 'u'),
            `${entry.sourceFile} must export ${entry.symbol}`,
        );
    }
});
