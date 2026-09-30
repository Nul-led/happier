import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';


type DesktopStorage = ReturnType<typeof createLocalStorage>;
type TauriInvoke = (command: string, args?: Record<string, unknown>) => unknown | Promise<unknown>;
const UPDATE_CHECKS_ENV = 'EXPO_PUBLIC_HAPPIER_DESKTOP_UPDATES_ENABLED';
const originalDevFlag = (globalThis as { __DEV__?: boolean }).__DEV__;

function createLocalStorage() {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        clear: () => void map.clear(),
    };
}

function clearDesktopGlobals() {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as any).window;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as any).__TAURI_INTERNALS__;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as any).localStorage;
    if (originalDevFlag === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as { __DEV__?: boolean }).__DEV__;
    } else {
        (globalThis as { __DEV__?: boolean }).__DEV__ = originalDevFlag;
    }
}

function setDesktopGlobals(options: {
    storage: DesktopStorage;
    invokeMock?: TauriInvoke;
    isDesktop: boolean;
}) {
    (globalThis as any).localStorage = options.storage;
    if (!options.isDesktop) {
        (globalThis as any).window = {};
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as any).__TAURI_INTERNALS__;
        return;
    }

    const internals = options.invokeMock ? { invoke: options.invokeMock } : {};
    (globalThis as any).window = { __TAURI_INTERNALS__: internals };
    (globalThis as any).__TAURI_INTERNALS__ = internals;
}

async function renderDesktopUpdaterHook(options: {
    storage: DesktopStorage;
    invokeMock?: TauriInvoke;
    isDesktop: boolean;
}) {
    setDesktopGlobals(options);
    const { useDesktopUpdater } = await import('./useDesktopUpdater');
    return renderHook(() => useDesktopUpdater());
}

describe('useDesktopUpdater (hook)', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        clearDesktopGlobals();
        (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    });

    afterEach(() => {
        standardCleanup();
        vi.unstubAllEnvs();
        clearDesktopGlobals();
    });

    it('stays idle when not running in Tauri', async () => {
        const storage = createLocalStorage();
        const hook = await renderDesktopUpdaterHook({
            storage,
            isDesktop: false,
        });

        const latest = hook.getCurrent();
        expect(latest?.status).toBe('idle');
        expect(latest?.availableVersion).toBe(null);
    });

    it('exposes an available update when updater returns metadata', async () => {
        const invokeMock = vi.fn(async (cmd: string) => {
            if (cmd === 'desktop_fetch_update') {
                return {
                    version: '9.9.9',
                    currentVersion: '9.9.8',
                    notes: null,
                    pubDate: null,
                };
            }
            throw new Error(`unexpected command: ${cmd}`);
        });

        const storage = createLocalStorage();
        const hook = await renderDesktopUpdaterHook({
            storage,
            invokeMock,
            isDesktop: true,
        });

        const latest = hook.getCurrent();
        expect(invokeMock).toHaveBeenCalledTimes(1);
        expect(invokeMock).toHaveBeenCalledWith('desktop_fetch_update', undefined);
        expect(latest?.status).toBe('available');
        expect(latest?.availableVersion).toBe('9.9.9');
    });

    it('shares the automatic check and manual refresh result between mounted desktop surfaces', async () => {
        const invokeMock = vi.fn<TauriInvoke>(async () => null);
        const storage = createLocalStorage();
        const first = await renderDesktopUpdaterHook({ storage, invokeMock, isDesktop: true });
        const second = await renderDesktopUpdaterHook({ storage, invokeMock, isDesktop: true });
        expect(invokeMock).toHaveBeenCalledTimes(1);
        expect(first.getCurrent()?.status).toBe('upToDate');
        expect(second.getCurrent()?.status).toBe('upToDate');

        invokeMock.mockResolvedValueOnce({ version: '1.0.1', currentVersion: '1.0.0', notes: null, pubDate: null });
        await act(async () => { await first.getCurrent()?.refresh(); });
        expect(first.getCurrent()?.availableVersion).toBe('1.0.1');
        expect(second.getCurrent()?.availableVersion).toBe('1.0.1');
        expect(first.getCurrent()?.lastCheckedAt).toEqual(second.getCurrent()?.lastCheckedAt);
    });

    it('keeps automatic unsupported checks quiet and reports a foreground failure through the same owner', async () => {
        const invokeMock = vi.fn<TauriInvoke>(async () => { throw new Error('HAPPIER_DESKTOP_NOT_IMPLEMENTED: desktop_fetch_update'); });
        const hook = await renderDesktopUpdaterHook({ storage: createLocalStorage(), invokeMock, isDesktop: true });
        expect(hook.getCurrent().status).toBe('idle');
        expect(hook.getCurrent().error).toBeNull();
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().status).toBe('error');
        expect(hook.getCurrent().error).toContain('HAPPIER_DESKTOP_NOT_IMPLEMENTED');
        expect(hook.getCurrent().lastCheckedAt).not.toBeNull();
        expect(invokeMock).toHaveBeenCalledTimes(2);
    });

    it('reports a failed manual check and recovers on retry', async () => {
        const invokeMock = vi.fn<TauriInvoke>(async () => null);
        const hook = await renderDesktopUpdaterHook({ storage: createLocalStorage(), invokeMock, isDesktop: true });
        invokeMock.mockRejectedValueOnce(new Error('signed feed unavailable'));
        await act(async () => { await hook.getCurrent()?.refresh(); });
        expect(hook.getCurrent()?.status).toBe('error');
        expect(hook.getCurrent()?.error).toBe('signed feed unavailable');
        invokeMock.mockResolvedValueOnce(null);
        await act(async () => { await hook.getCurrent()?.refresh(); });
        expect(hook.getCurrent()?.status).toBe('upToDate');
        expect(hook.getCurrent()?.error).toBeNull();
    });

    it('retries a failed automatic check when another desktop surface mounts', async () => {
        const invokeMock = vi.fn<TauriInvoke>().mockRejectedValueOnce(new Error('feed unavailable')).mockResolvedValueOnce(null);
        const storage = createLocalStorage();
        const first = await renderDesktopUpdaterHook({ storage, invokeMock, isDesktop: true });
        expect(first.getCurrent().status).toBe('idle');
        const second = await renderDesktopUpdaterHook({ storage, invokeMock, isDesktop: true });
        expect(second.getCurrent().status).toBe('upToDate');
        expect(first.getCurrent().status).toBe('upToDate');
        expect(invokeMock).toHaveBeenCalledTimes(2);
    });

    it('reports checking rather than an available update while retrying a failed check', async () => {
        const invokeMock = vi.fn<TauriInvoke>(async () => null);
        const hook = await renderDesktopUpdaterHook({ storage: createLocalStorage(), invokeMock, isDesktop: true });
        invokeMock.mockRejectedValueOnce(new Error('feed unavailable'));
        await act(async () => { await hook.getCurrent().refresh(); });
        const pending = createDeferred<null>();
        invokeMock.mockReturnValueOnce(pending.promise);
        let refresh!: Promise<void>;
        await act(async () => { refresh = hook.getCurrent().refresh(); });
        try {
            expect(hook.getCurrent().status).toBe('checking');
            expect(hook.getCurrent().availableVersion).toBeNull();
            expect(hook.getCurrent().isChecking).toBe(true);
        } finally {
            await act(async () => { pending.resolve(null); await refresh; });
        }
    });

    it('keeps the last available update visible while a manual check is pending', async () => {
        const pending = createDeferred<null>();
        const invokeMock = vi.fn<TauriInvoke>(async () => ({ version: '1.0.1', currentVersion: '1.0.0', notes: null, pubDate: null }));
        const hook = await renderDesktopUpdaterHook({ storage: createLocalStorage(), invokeMock, isDesktop: true });
        invokeMock.mockReturnValueOnce(pending.promise);
        let refresh!: Promise<void>;
        await act(async () => { refresh = hook.getCurrent().refresh(); });
        expect(hook.getCurrent().status).toBe('available');
        expect(hook.getCurrent().availableVersion).toBe('1.0.1');
        expect(hook.getCurrent().isChecking).toBe(true);
        await act(async () => { pending.resolve(null); await refresh; });
        expect(hook.getCurrent().status).toBe('upToDate');
        expect(hook.getCurrent().isChecking).toBe(false);
    });

    it('shares an installation and prevents a check from replacing its native pending update', async () => {
        const pending = createDeferred<boolean>();
        const invokeMock = vi.fn<TauriInvoke>(async (command) => command === 'desktop_fetch_update'
            ? { version: '1.0.1', currentVersion: '1.0.0', notes: null, pubDate: null }
            : pending.promise);
        const storage = createLocalStorage();
        const first = await renderDesktopUpdaterHook({ storage, invokeMock, isDesktop: true });
        const second = await renderDesktopUpdaterHook({ storage, invokeMock, isDesktop: true });
        let installation!: Promise<void>;
        let duplicate!: Promise<void>;
        let refresh!: Promise<void>;
        await act(async () => {
            installation = first.getCurrent().startInstall();
            duplicate = second.getCurrent().startInstall();
            refresh = second.getCurrent().refresh();
        });
        expect(first.getCurrent().status).toBe('installing');
        expect(second.getCurrent().status).toBe('installing');
        expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['desktop_fetch_update', 'desktop_install_update']);
        await act(async () => { pending.resolve(false); await Promise.all([installation, duplicate, refresh]); });
        expect(first.getCurrent().status).toBe('upToDate');
        expect(second.getCurrent().status).toBe('upToDate');
    });

    it('persists dismissal until available version changes', async () => {
        const invokeMock = vi.fn(async () => {
            return {
                version: '1.0.1',
                currentVersion: '1.0.0',
                notes: null,
                pubDate: null,
            };
        });

        const storage = createLocalStorage();
        const hook = await renderDesktopUpdaterHook({
            storage,
            invokeMock,
            isDesktop: true,
        });

        expect(hook.getCurrent()?.status).toBe('available');
        act(() => {
            hook.getCurrent()?.dismiss();
        });
        expect(hook.getCurrent()?.status).toBe('dismissed');
        expect(storage.getItem('desktop_update_dismissed_version')).toBe('1.0.1');
    });

    it('returns to up-to-date when install command reports no pending update', async () => {
        const invokeMock = vi.fn(async (cmd: string) => {
            if (cmd === 'desktop_fetch_update') {
                return {
                    version: '1.0.2',
                    currentVersion: '1.0.1',
                    notes: null,
                    pubDate: null,
                };
            }
            if (cmd === 'desktop_install_update') {
                return false;
            }
            throw new Error(`unexpected command: ${cmd}`);
        });

        const storage = createLocalStorage();
        const hook = await renderDesktopUpdaterHook({
            storage,
            invokeMock,
            isDesktop: true,
        });

        expect(hook.getCurrent()?.status).toBe('available');

        await act(async () => {
            await hook.getCurrent()?.startInstall();
        });
        await flushHookEffects();

        const latest = hook.getCurrent();
        expect(invokeMock).toHaveBeenCalledWith('desktop_install_update', undefined);
        expect(latest?.status).toBe('upToDate');
        expect(latest?.availableVersion).toBe(null);
    });

    it('does not check for updates when running from a source development Tauri bundle', async () => {
        (globalThis as { __DEV__?: boolean }).__DEV__ = true;

        const invokeMock = vi.fn(async (cmd: string) => {
            if (cmd === 'desktop_fetch_update') {
                return {
                    version: '9.9.9',
                    currentVersion: '9.9.8',
                    notes: null,
                    pubDate: null,
                };
            }
            throw new Error(`unexpected command: ${cmd}`);
        });

        const storage = createLocalStorage();
        const hook = await renderDesktopUpdaterHook({
            storage,
            invokeMock,
            isDesktop: true,
        });

        const latest = hook.getCurrent();
        expect(invokeMock).toHaveBeenCalledTimes(0);
        expect(latest?.status).toBe('idle');
        expect(latest?.availableVersion).toBe(null);
    });

    it('continues checking updates for installed desktop dev-channel release bundles', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        (globalThis as { __DEV__?: boolean }).__DEV__ = false;
        const invokeMock = vi.fn(async (cmd: string) => {
            if (cmd === 'desktop_fetch_update') {
                return {
                    version: '9.9.9',
                    currentVersion: '9.9.8',
                    notes: null,
                    pubDate: null,
                };
            }
            throw new Error(`unexpected command: ${cmd}`);
        });

        const storage = createLocalStorage();
        const hook = await renderDesktopUpdaterHook({
            storage,
            invokeMock,
            isDesktop: true,
        });

        const latest = hook.getCurrent();
        expect(invokeMock).toHaveBeenCalledWith('desktop_fetch_update', undefined);
        expect(latest?.status).toBe('available');
        expect(latest?.availableVersion).toBe('9.9.9');
    });

    it('allows update checks in source development bundles when explicitly enabled', async () => {
        vi.stubEnv(UPDATE_CHECKS_ENV, '1');
        (globalThis as { __DEV__?: boolean }).__DEV__ = true;
        const invokeMock = vi.fn(async (cmd: string) => {
            if (cmd === 'desktop_fetch_update') {
                return {
                    version: '9.9.9',
                    currentVersion: '9.9.8',
                    notes: null,
                    pubDate: null,
                };
            }
            throw new Error(`unexpected command: ${cmd}`);
        });

        const storage = createLocalStorage();
        const hook = await renderDesktopUpdaterHook({
            storage,
            invokeMock,
            isDesktop: true,
        });

        const latest = hook.getCurrent();
        expect(invokeMock).toHaveBeenCalledWith('desktop_fetch_update', undefined);
        expect(latest?.status).toBe('available');
        expect(latest?.availableVersion).toBe('9.9.9');
    });
});
