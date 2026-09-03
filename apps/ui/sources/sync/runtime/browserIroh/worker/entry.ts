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
 * One worker global per browser application/profile means one endpoint owner
 * shared by every tab. The worker's own lifetime is the browser's to decide:
 * this file starts no timer and closes nothing on its own. Terminal shutdown is
 * either the browser ending the worker global or an explicit application-data
 * clear arriving over the command boundary.
 *
 * The A7.3 stream commands remain a dormant transport foundation; no production
 * request, Socket.IO, QR, Account Service, or transfer consumer is activated here.
 */

import { createIndexedDbBrowserIrohEndpointKeyStore } from '../indexedDbEndpointKeyStore';
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
    indexedDB: IDBFactory;
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
    keyStore: createIndexedDbBrowserIrohEndpointKeyStore(scope.indexedDB),
    randomBytes: (length) => scope.crypto.getRandomValues(new Uint8Array(length)),
    bindEndpoint: createBrowserIrohWasmBinder(loadPackagedWasmModule),
});

const handleConnection = createBrowserIrohWorkerConnectionHandler(owner);

scope.onconnect = (event) => {
    for (const port of event.ports) {
        handleConnection(port);
    }
};
