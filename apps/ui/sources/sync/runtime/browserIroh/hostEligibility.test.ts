import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    isBrowserIrohHost,
    resolveBrowserIrohHostDecision,
    type BrowserIrohHostCapabilities,
} from './hostEligibility';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeWebMock();
});

const BROWSER: BrowserIrohHostCapabilities = { hasSharedWorker: true, hasIndexedDb: true };

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';

const ELECTRON_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
    + ' happier-desktop/0.3.0 Chrome/150.0.0.0 Electron/43.4.0 Safari/537.36';
const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
    + ' Chrome/150.0.0.0 Safari/537.36';

function setUserAgent(userAgent: string) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { userAgent },
    });
}

afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as Record<string, unknown>)[TAURI_INTERNALS_KEY];
    Reflect.deleteProperty(globalThis, 'navigator');
});

describe('sync/runtime/browserIroh/hostEligibility', () => {
    it('accepts a pure browser web runtime', () => {
        setUserAgent(BROWSER_USER_AGENT);
        expect(resolveBrowserIrohHostDecision(BROWSER)).toEqual({ eligible: true });
        expect(isBrowserIrohHost(BROWSER)).toBe(true);
    });

    it('excludes a Tauri desktop host that runs the same web bundle', () => {
        setUserAgent(BROWSER_USER_AGENT);
        (globalThis as Record<string, unknown>)[TAURI_INTERNALS_KEY] = { invoke: () => null };

        expect(resolveBrowserIrohHostDecision(BROWSER)).toEqual({
            eligible: false,
            reason: 'desktop_host',
        });
    });

    it('excludes an Electron desktop host that publishes a Tauri-shaped bridge', () => {
        setUserAgent(ELECTRON_USER_AGENT);
        (globalThis as Record<string, unknown>)[TAURI_INTERNALS_KEY] = { invoke: () => null };

        expect(resolveBrowserIrohHostDecision(BROWSER)).toEqual({
            eligible: false,
            reason: 'desktop_host',
        });
    });

    it('reports the missing capability rather than falling back to a per-tab endpoint', () => {
        setUserAgent(BROWSER_USER_AGENT);

        expect(resolveBrowserIrohHostDecision({ hasSharedWorker: false, hasIndexedDb: true })).toEqual({
            eligible: false,
            reason: 'shared_worker_unsupported',
        });
        expect(resolveBrowserIrohHostDecision({ hasSharedWorker: true, hasIndexedDb: false })).toEqual({
            eligible: false,
            reason: 'indexed_db_unsupported',
        });
    });
});
