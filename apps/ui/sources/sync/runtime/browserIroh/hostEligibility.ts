/**
 * Which runtimes may use the browser Iroh carrier (Lane 06 amendment A7).
 *
 * Pure browser web only. Recognized Tauri and Electron desktop hosts run the
 * same web bundle but keep the native Iroh implementation, which can bind a
 * local listener and use direct-or-relay paths; giving them a relay-only browser
 * endpoint as well would be a second transport owner for the same concept.
 * Native mobile targets never reach this path at all.
 *
 * `desktopHostKind` stays the single host-identity decision; this module asks it
 * rather than re-sniffing host globals.
 */

import { Platform } from 'react-native';

import { desktopHostKind } from '@/utils/platform/desktopHost';

export type BrowserIrohHostIneligibility =
    | 'not_web'
    | 'desktop_host'
    | 'shared_worker_unsupported'
    | 'indexed_db_unsupported';

export type BrowserIrohHostDecision =
    | Readonly<{ eligible: true }>
    | Readonly<{ eligible: false; reason: BrowserIrohHostIneligibility }>;

/**
 * The capabilities the cross-tab owner actually needs, read from the runtime.
 * Injectable so a test can describe a browser without pretending to be one.
 */
export type BrowserIrohHostCapabilities = Readonly<{
    hasSharedWorker: boolean;
    hasIndexedDb: boolean;
}>;

export function readBrowserIrohHostCapabilities(): BrowserIrohHostCapabilities {
    const scope = globalThis as Record<string, unknown>;
    return {
        hasSharedWorker: typeof scope.SharedWorker === 'function',
        hasIndexedDb: typeof scope.indexedDB === 'object' && scope.indexedDB !== null,
    };
}

export function resolveBrowserIrohHostDecision(
    capabilities: BrowserIrohHostCapabilities = readBrowserIrohHostCapabilities(),
): BrowserIrohHostDecision {
    if (Platform.OS !== 'web') {
        return { eligible: false, reason: 'not_web' };
    }
    if (desktopHostKind() !== null) {
        return { eligible: false, reason: 'desktop_host' };
    }
    // A single endpoint per browser profile is the contract, not an aspiration:
    // without SharedWorker there is no place to hold it that outlives one tab,
    // so the carrier is unavailable rather than silently per-tab.
    if (!capabilities.hasSharedWorker) {
        return { eligible: false, reason: 'shared_worker_unsupported' };
    }
    // The endpoint seed must survive reload, and IndexedDB is the only
    // device-local store the owner's worker global can reach.
    if (!capabilities.hasIndexedDb) {
        return { eligible: false, reason: 'indexed_db_unsupported' };
    }
    return { eligible: true };
}

export function isBrowserIrohHost(capabilities?: BrowserIrohHostCapabilities): boolean {
    return resolveBrowserIrohHostDecision(capabilities).eligible;
}
