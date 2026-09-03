/**
 * Page-side harness for the real Chromium shared-endpoint proof
 * (`runBrowserIrohSharedEndpointProof.mjs`).
 *
 * This is NOT app code and NOT part of the app bundle: it is bundled by the
 * proof driver with esbuild and served to the browser, exactly like the
 * packaged SharedWorker it connects to. It reuses the real protocol parser and
 * the real packaged-asset URL rule from the owner module, so the proof drives
 * the same wire shapes the production tab client drives — only the transport
 * (`new SharedWorker` on the packaged asset) is spelled out here because the
 * production `endpointClient` reaches `react-native` through the host
 * eligibility decision and cannot load in this plain page.
 *
 * The client lives inside the page; Playwright can only pass plain data across
 * `evaluate`, so every command resolves to the parsed worker reply object.
 */

import {
    BROWSER_IROH_WORKER_ASSET,
    browserIrohAssetUrl,
} from '../../sources/sync/runtime/browserIroh/assets';
import {
    parseBrowserIrohWorkerReply,
    type BrowserIrohWorkerReply,
} from '../../sources/sync/runtime/browserIroh/protocol';

type ProofClient = Readonly<{
    acquireLease: (relayUrls: readonly string[]) => Promise<BrowserIrohWorkerReply>;
    releaseAll: () => Promise<BrowserIrohWorkerReply>;
    status: () => Promise<BrowserIrohWorkerReply>;
    clearApplicationData: () => Promise<BrowserIrohWorkerReply>;
}>;

function connectSharedEndpointWorker(base: string): ProofClient {
    const worker = new SharedWorker(browserIrohAssetUrl(BROWSER_IROH_WORKER_ASSET, base), {
        type: 'module',
        name: 'happier-iroh',
    });
    const pending = new Map<string, (reply: BrowserIrohWorkerReply) => void>();
    worker.port.addEventListener('message', (event: MessageEvent) => {
        const reply = parseBrowserIrohWorkerReply(event.data);
        if (reply === null) return;
        const settle = pending.get(reply.requestId);
        if (settle === undefined) return;
        pending.delete(reply.requestId);
        settle(reply);
    });
    worker.port.start();

    let counter = 0;
    const send = (command: Record<string, unknown>): Promise<BrowserIrohWorkerReply> =>
        new Promise((resolve) => {
            const requestId = `proof-${++counter}`;
            pending.set(requestId, resolve);
            worker.port.postMessage({ ...command, v: 1, requestId });
        });

    return {
        acquireLease: (relayUrls) => send({ kind: 'acquireLease', relayUrls: [...relayUrls] }),
        releaseAll: () => send({ kind: 'releaseClient' }),
        status: () => send({ kind: 'status' }),
        clearApplicationData: () => send({ kind: 'clearApplicationData' }),
    };
}

declare global {
    interface Window {
        __happierIrohProofConnect: (base: string) => ProofClient;
    }
}

window.__happierIrohProofConnect = connectSharedEndpointWorker;
