// The Metro-owned build for the loaded browser Iroh proof page (Lane 06 A7.3).
//
// The A7.2 proof page is bundled with esbuild, which is sufficient only because
// it imports two leaf modules. The A7.3 page has to import the PRODUCTION
// owners — the browser Home carrier runtime, `serverFetch`, and the Socket.IO
// transport — and those reach `react-native`, `@/...`, `@happier-dev/*` source
// exports, and the web platform shims. Reproducing that resolution in esbuild
// would be a second bundler config for the app graph, so this delegates to the
// canonical owner instead: `apps/ui/metro.config.js`, the exact config the web
// export uses, driven through Metro's own `runBuild`.
//
// Nothing here configures resolution. If a module resolves differently for this
// page than for a production web build, that is a Metro config fact, not a
// proof-local one — which is the entire point.
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsIrohDir = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(toolsIrohDir, '..', '..');

/** The one canonical Metro/Expo web bundling owner this proof builds through. */
export const PRODUCTION_PROOF_PAGE_METRO_CONFIG = resolve(uiDir, 'metro.config.js');

/**
 * Builds one browser ES bundle for `entryFile` with the app's own web config.
 *
 * Returns the written bundle path plus the module graph Metro actually
 * included, read from the emitted source map. Callers use that list to assert
 * the production owners are genuinely in the page rather than trusting the
 * page's import statements.
 */
export async function loadProductionProofPageMetroConfig() {
  const metro = await import('metro');
  return await metro.loadConfig({
    cwd: uiDir,
    config: PRODUCTION_PROOF_PAGE_METRO_CONFIG,
  });
}

/**
 * The proof page is built the way the app's own web release is built.
 *
 * `dev: false` and `minify: true` are the production web configuration, and the
 * point of this page is that the production owners are reached exactly as a
 * production web export reaches them. It is also the difference between a page
 * Chromium can load and one it cannot: unminified, this graph is ~94 MB of
 * script the browser has to parse before a single observation can be made.
 *
 * A caller may still pass `minify: false` — the source-map contract below is
 * decided by the build owner's options, not by how the code was compressed.
 */
export async function buildProductionProofPageBundle({
  entryFile,
  outFile,
  dev = false,
  minify = true,
}) {
  const metro = await import('metro');
  const config = await loadProductionProofPageMetroConfig();

  const sourceMapFile = `${outFile}.map`;
  await metro.runBuild(config, {
    entry: entryFile,
    out: outFile,
    bundleOut: outFile,
    sourceMap: true,
    sourceMapOut: sourceMapFile,
    // Metro inlines the whole source map into the bundle as a base64 data URI
    // unless a URL is named (`inlineSourceMap: sourceMap && !sourceMapUrl` in
    // `metro/src/index.flow.js`). On the real page graph that map is ~157 MB,
    // so inlining it made a 304 MB page no browser could finish loading, while
    // `sourceMapOut` wrote the same map to disk anyway. Naming the sibling URL
    // keeps the map the graph check reads and leaves the page the code alone.
    sourceMapUrl: `${basename(outFile)}.map`,
    platform: 'web',
    dev,
    minify,
    assets: false,
  });

  const graphFiles = JSON.parse(readFileSync(sourceMapFile, 'utf8')).sources ?? [];
  return {
    bundleFile: outFile,
    sourceMapFile,
    graphFiles: graphFiles.map((file) => resolve(uiDir, file)),
  };
}
