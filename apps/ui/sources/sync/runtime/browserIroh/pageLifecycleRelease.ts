/**
 * Handing a page's leases back when the page ends (Lane 06 amendment A7.2).
 *
 * A SharedWorker may remain alive while sibling browsing contexts still use it,
 * but its lifetime is user-agent controlled and it is not durable after the
 * final context disappears. A tab that reloads, navigates away, or closes
 * without saying anything can leave its leases held by a client id no port
 * answers for while the worker remains live. `pagehide` is the ordinary end of
 * a page in every browser this carrier runs in, and posting the existing
 * `releaseClient` command there is the entire mechanism: no heartbeat, no timer,
 * no expiry, and no second owner of what a client holds.
 *
 * It is best-effort by construction. The page may already be unloading, so
 * nothing is awaited and no reply is correlated; a lost message is exactly the
 * situation that existed before. Complete worker destruction releases the
 * ephemeral endpoint and all remaining custody. The explicit `releaseAll`
 * command remains the truthful awaited path, and the worker-side owner remains
 * the only authority over lease custody while it lives.
 */

import type { BrowserIrohClientCommand } from './protocol';

/** The page-lifecycle boundary, narrowed to what this seam uses. */
export type BrowserIrohPageLifecycle = Readonly<{
    addEventListener: (type: 'pagehide', listener: () => void) => void;
    removeEventListener: (type: 'pagehide', listener: () => void) => void;
}>;

/**
 * The host's own page lifecycle, or `null` where there is no page: a worker
 * global, a native runtime, or a test that describes a browser rather than
 * pretending to be one.
 */
export function readBrowserIrohPageLifecycle(): BrowserIrohPageLifecycle | null {
    const scope = globalThis as Record<string, unknown>;
    if (typeof scope.addEventListener !== 'function' || typeof scope.removeEventListener !== 'function') {
        return null;
    }
    if (typeof scope.document !== 'object' || scope.document === null) return null;
    return globalThis as unknown as BrowserIrohPageLifecycle;
}

/**
 * Registers the best-effort release for one connected port and returns the
 * detach function its owner calls when it closes.
 */
export function attachBrowserIrohPageLifecycleRelease(
    input: Readonly<{
        postMessage: (message: unknown) => void;
        newRequestId: () => string;
        lifecycle?: BrowserIrohPageLifecycle | null;
    }>,
): () => void {
    const lifecycle = input.lifecycle === undefined ? readBrowserIrohPageLifecycle() : input.lifecycle;
    if (lifecycle === null) return () => {};

    const release = (): void => {
        input.postMessage({
            v: 1,
            kind: 'releaseClient',
            requestId: input.newRequestId(),
        } satisfies BrowserIrohClientCommand);
    };
    lifecycle.addEventListener('pagehide', release);
    return () => {
        lifecycle.removeEventListener('pagehide', release);
    };
}
