/**
 * The packaged browser Iroh assets (Lane 06 amendment A7.2/A7.5).
 *
 * The wasm-bindgen boundary generated from `happier-iroh-wasm` and the
 * SharedWorker bootstrap that hosts the endpoint owner are static files served
 * from the app's own origin under `vendor/iroh/`. They are produced
 * deterministically by `apps/ui/tools/iroh/buildBrowserIrohAssets.mjs` from the
 * A7.1 build owner, which stages them into the web output that build owns (never
 * a shared source tree the Tauri and native exports also copy); nothing at
 * runtime reads Cargo's ignored `target/` output, fetches from a CDN, shells out
 * to a system tool, or generates them on demand.
 *
 * They are never referenced at startup. Production Home HTTP, Socket.IO, and
 * finite Machine transfers load these URLs only when an eligible caller asks
 * the browser Iroh client to connect.
 */

/** Path segment under the app's web static root, appended to the deployment base. */
export const BROWSER_IROH_ASSET_DIRECTORY = 'vendor/iroh';

/** The SharedWorker bootstrap that hosts the one endpoint owner. */
export const BROWSER_IROH_WORKER_ASSET = 'happier-iroh-worker.js';

/** The generated wasm-bindgen JS boundary and its module. */
export const BROWSER_IROH_WASM_GLUE_ASSET = 'happier_iroh_wasm.js';
export const BROWSER_IROH_WASM_BINARY_ASSET = 'happier_iroh_wasm_bg.wasm';

/**
 * Every runtime file the packaging step must place under
 * {@link BROWSER_IROH_ASSET_DIRECTORY}: generated WASM, JavaScript glue, and
 * worker bytes only (Lane 06 amendment A9). The wasm-bindgen declaration files
 * remain build/typecheck artifacts in the wasm build output; nothing fetches
 * them at runtime, so they are not staged or verified as browser assets. The
 * packaging tool verifies this exact list directly, so a
 * rename cannot land on one side only and 404 at runtime.
 */
export const BROWSER_IROH_PACKAGED_ASSETS = [
    BROWSER_IROH_WORKER_ASSET,
    BROWSER_IROH_WASM_GLUE_ASSET,
    BROWSER_IROH_WASM_BINARY_ASSET,
] as const;

/**
 * The one asset URL rule. `base` is the deployment base the packaged assets
 * resolve from — the app origin plus the web output's configured base path —
 * never the tab's current navigation URL.
 *
 * The base names a directory, but callers hold it in either spelling
 * (`https://origin` / `https://origin/app`, or with a trailing slash). Without
 * the trailing slash, URL relative resolution would replace the base's last
 * segment — silently dropping the configured base path and 404ing every
 * subpath deployment — so the rule normalizes to the directory form itself.
 */
export function browserIrohAssetUrl(assetName: string, base: string): string {
    const directoryBase = base.endsWith('/') ? base : `${base}/`;
    return new URL(`${BROWSER_IROH_ASSET_DIRECTORY}/${assetName}`, directoryBase).toString();
}
