/**
 * The browser Iroh SharedWorker bootstrap (Lane 06 amendment A7.2/A7.3).
 *
 * This file is NOT part of the app bundle. It is the entry point that
 * `apps/ui/tools/iroh/buildBrowserIrohAssets.mjs` bundles into
 * `<web-output>/vendor/iroh/happier-iroh-worker.js`, next to the generated
 * wasm-bindgen boundary it loads by relative URL. The producer writes only to
 * the selected web output, never the shared source `public/` tree. Metro never
 * sees it, because nothing in `sources/**` imports it.
 *
 * One worker global means one ephemeral endpoint owner shared by every tab
 * connected to that live worker. The worker's own lifetime is the browser's to
 * decide: this file starts no timer and closes nothing on its own. Per-tab
 * release drops that client's leases and streams; browser destruction of the
 * worker global is terminal endpoint cleanup.
 *
 * Production Home HTTP, Socket.IO, and finite Machine transfers consume these
 * stream commands through their existing application owners.
 */

import { createBrowserIrohSharedEndpointOwner } from '../sharedEndpointOwner';
import { createBrowserIrohWasmBinder } from '../wasmBinder';
import {
    createBrowserIrohWorkerConnectionHandler,
    type BrowserIrohMessagePort,
} from '../workerConnection';
import { BROWSER_IROH_WASM_BINARY_ASSET, BROWSER_IROH_WASM_GLUE_ASSET } from '../assets';

type SharedWorkerConnectEvent = { ports: readonly BrowserIrohMessagePort[] };

type SharedWorkerScope = {
    onconnect: ((event: SharedWorkerConnectEvent) => void) | null;
    crypto: Crypto;
};

const scope = globalThis as unknown as SharedWorkerScope;

/**
 * The generated boundary sits beside this bundle. The specifier is computed at
 * runtime so the bundler leaves it alone: it is a packaged sibling asset, not a
 * module the app graph resolves.
 */
async function loadPackagedWasmModule(): Promise<{ module: unknown; wasmUrl: string }> {
    const glueUrl = new URL(`./${BROWSER_IROH_WASM_GLUE_ASSET}`, import.meta.url).toString();
    const wasmUrl = new URL(`./${BROWSER_IROH_WASM_BINARY_ASSET}`, import.meta.url).toString();
    const module: unknown = await import(/* @vite-ignore */ glueUrl);
    return { module, wasmUrl };
}

const owner = createBrowserIrohSharedEndpointOwner({
    randomBytes: (length) => scope.crypto.getRandomValues(new Uint8Array(length)),
    bindEndpoint: createBrowserIrohWasmBinder(loadPackagedWasmModule),
});

const handleConnection = createBrowserIrohWorkerConnectionHandler(owner);

scope.onconnect = (event) => {
    for (const port of event.ports) {
        handleConnection(port);
    }
};
