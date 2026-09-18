import { isDesktopHost } from '@/utils/platform/desktopHost';

import { installTauriMcpWebviewDriverScripts } from './installTauriMcpWebviewDriverScripts';

type McpBridgeWindowLike = typeof globalThis;

/**
 * Whether this bundle is a development build.
 *
 * The driver surface below is QA-only and every one of its commands drives real machine state, so
 * this reads the bundler's `__DEV__` global and **fails closed**: a bundle where the global is
 * absent is treated as production. `tauri dev` (what every MCP QA journey launches) serves the
 * Metro dev bundle, where it is `true`.
 */
function isDevBuildBundle(): boolean {
    return typeof __DEV__ === 'boolean' ? __DEV__ : false;
}

/**
 * Installs the QA driver surface `mcp-server-tauri` talks to — and only in a development build.
 *
 * `apps/ui/scripts/tauri-mcp-qa.md` states the intent ("dev-only … without affecting production
 * builds") and the Rust plugin honours it behind `debug_assertions`; this is the JavaScript half of
 * the same gate. Without it a shipped desktop app publishes `window.__MCP__` commands that pause a
 * durable Personal Home bootstrap mutation, stop the daemon, and uninstall the Personal Home
 * runtime. No product code reads `__MCP__`; only the QA scripts under `apps/ui/scripts/qa/` do.
 */
export function maybeInstallTauriMcpBridge(options?: Readonly<{
    isDesktopShell?: boolean;
    isDevBuild?: boolean;
    documentObj?: Document;
    windowObj?: McpBridgeWindowLike;
}>) {
    const isDesktopShell = options?.isDesktopShell ?? isDesktopHost();
    if (!isDesktopShell) {
        return;
    }
    if (!(options?.isDevBuild ?? isDevBuildBundle())) {
        return;
    }
    installTauriMcpWebviewDriverScripts({
        windowObj: options?.windowObj,
        documentObj: options?.documentObj,
    });
}

export function installTauriMcpBridgeOnce(options?: Readonly<{
    isDesktopShell?: boolean;
    isDevBuild?: boolean;
    documentObj?: Document;
    windowObj?: McpBridgeWindowLike;
}>) {
    const g = globalThis as unknown as Record<string, unknown> | undefined;
    if (!g) {
        return;
    }
    const key = '__HAPPIER_TAURI_MCP_BRIDGE_INSTALLED__';
    if (g[key] === true) {
        return;
    }
    g[key] = true;
    maybeInstallTauriMcpBridge(options);
}

