import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTauriMcpWebviewDriverScripts } from './installTauriMcpWebviewDriverScripts';
import { maybeInstallTauriMcpBridge } from './maybeInstallTauriMcpBridge';

const ensureSessionVisibleForMessageRouteMock = vi.hoisted(() => vi.fn());
const legacyEnsureSessionVisibleForMessageRouteMock = vi.hoisted(() => vi.fn());
const getSyncSingletonMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: getSyncSingletonMock,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        ensureSessionVisibleForMessageRoute: legacyEnsureSessionVisibleForMessageRouteMock,
    },
}));

describe('installTauriMcpWebviewDriverScripts', () => {
    beforeEach(() => {
        ensureSessionVisibleForMessageRouteMock.mockReset();
        legacyEnsureSessionVisibleForMessageRouteMock.mockReset();
        getSyncSingletonMock.mockReset();
        getSyncSingletonMock.mockReturnValue({
            ensureSessionVisibleForMessageRoute: ensureSessionVisibleForMessageRouteMock,
        });
        ensureSessionVisibleForMessageRouteMock.mockResolvedValue(true);
        legacyEnsureSessionVisibleForMessageRouteMock.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('installs resolveRef helpers expected by mcp-server-tauri tooling', () => {
        const element = { tagName: 'BUTTON' } as unknown as Element;
        const reverseRefs = new Map<string, Element>([['e1', element]]);

        const windowObj = {
            __MCP__: {
                reverseRefs,
            },
        } as unknown as typeof globalThis;

        const documentObj = {
            querySelector: () => element,
            querySelectorAll: () => [element],
            evaluate: () => ({ singleNodeValue: element, snapshotLength: 1, snapshotItem: () => element }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({ windowObj, documentObj });

        expect(typeof (windowObj as unknown as { __MCP__?: { resolveRef?: unknown } }).__MCP__?.resolveRef).toBe('function');
        expect(typeof (windowObj as unknown as { __MCP__?: { resolveAll?: unknown } }).__MCP__?.resolveAll).toBe('function');
        expect(typeof (windowObj as unknown as { __MCP__?: { countAll?: unknown } }).__MCP__?.countAll).toBe('function');
    });

    it('installs a canonical local-settings writer helper for the Tauri MCP bridge', async () => {
        const applied: Array<Record<string, unknown>> = [];
        let flushCount = 0;
        const windowObj = {
            __MCP__: {},
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            applyLocalSettings: (delta) => {
                applied.push(delta);
            },
            flushDesktopOverlaySync: () => {
                flushCount += 1;
            },
        });

        const result = await (
            windowObj as unknown as {
                __MCP__?: {
                    applyHappierLocalSettings?: (delta: unknown) => Promise<{ ok: boolean; appliedKeys?: string[] }>;
                };
            }
        ).__MCP__?.applyHappierLocalSettings?.({
            desktopOverlayEnabled: true,
            desktopOverlayVisibilityMode: 'active_sessions',
        });

        expect(result).toMatchObject({
            ok: true,
            appliedKeys: ['desktopOverlayEnabled', 'desktopOverlayVisibilityMode'],
        });
        expect(applied).toEqual([
            {
                desktopOverlayEnabled: true,
                desktopOverlayVisibilityMode: 'active_sessions',
            },
        ]);
        expect(flushCount).toBe(1);
    });

    it('overwrites any preexisting applyHappierLocalSettings implementation so desktop overlay settings always flush', async () => {
        const applied: Array<Record<string, unknown>> = [];
        let flushCount = 0;
        let legacyCalled = 0;
        const windowObj = {
            __MCP__: {
                applyHappierLocalSettings: () => {
                    legacyCalled += 1;
                    return { ok: false, reason: 'legacy' };
                },
            },
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            applyLocalSettings: (delta) => {
                applied.push(delta);
            },
            flushDesktopOverlaySync: () => {
                flushCount += 1;
            },
        });

        const result = await (
            windowObj as unknown as {
                __MCP__?: {
                    applyHappierLocalSettings?: (delta: unknown) => Promise<{ ok: boolean; appliedKeys?: string[] }>;
                };
            }
        ).__MCP__?.applyHappierLocalSettings?.({
            desktopOverlayEnabled: true,
        });

        expect(result).toMatchObject({
            ok: true,
            appliedKeys: ['desktopOverlayEnabled'],
        });
        expect(legacyCalled).toBe(0);
        expect(applied).toEqual([{ desktopOverlayEnabled: true }]);
        expect(flushCount).toBe(1);
    });

    it('awaits the overlay sync flush before reporting local-settings writes as complete', async () => {
        const windowObj = {
            __MCP__: {},
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        let flushCount = 0;
        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            applyLocalSettings: () => {},
            flushDesktopOverlaySync: async () => {
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 0);
                });
                flushCount += 1;
            },
        });

        const promise = (
            windowObj as unknown as {
                __MCP__?: {
                    applyHappierLocalSettings?: (delta: unknown) => Promise<{ ok: boolean }>;
                };
            }
        ).__MCP__?.applyHappierLocalSettings?.({ desktopOverlayEnabled: true });

        expect(flushCount).toBe(0);
        await promise;
        expect(flushCount).toBe(1);
    });

    it('installs a canonical session-visibility helper for the Tauri MCP bridge', async () => {
        const ensured: Array<{ sessionId: string; options?: { forceRefresh?: boolean } }> = [];
        const windowObj = {
            __MCP__: {},
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            ensureSessionVisible: async (sessionId, options) => {
                ensured.push({ sessionId, options });
                return true;
            },
        });

        const result = await (
            windowObj as unknown as {
                __MCP__?: {
                    ensureHappierSessionVisible?: (
                        sessionId: unknown,
                        options?: { forceRefresh?: boolean },
                    ) => Promise<{ ok: boolean; sessionId?: string }>;
                };
            }
        ).__MCP__?.ensureHappierSessionVisible?.('sess_overlay', { forceRefresh: true });

        expect(result).toEqual({
            ok: true,
            sessionId: 'sess_overlay',
        });
        expect(ensured).toEqual([
            {
                sessionId: 'sess_overlay',
                options: { forceRefresh: true },
            },
        ]);
    });

    it('uses the runtime sync singleton for the default session-visibility helper', async () => {
        const windowObj = {
            __MCP__: {},
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
        });

        const result = await (
            windowObj as unknown as {
                __MCP__?: {
                    ensureHappierSessionVisible?: (
                        sessionId: unknown,
                        options?: { forceRefresh?: boolean },
                    ) => Promise<{ ok: boolean; sessionId?: string }>;
                };
            }
        ).__MCP__?.ensureHappierSessionVisible?.('sess_overlay', { forceRefresh: true });

        expect(result).toEqual({
            ok: true,
            sessionId: 'sess_overlay',
        });
        expect(getSyncSingletonMock).toHaveBeenCalledTimes(1);
        expect(ensureSessionVisibleForMessageRouteMock).toHaveBeenCalledWith('sess_overlay', { forceRefresh: true });
        expect(legacyEnsureSessionVisibleForMessageRouteMock).not.toHaveBeenCalled();
    });

    it('exposes checked-in Personal Home QA boundaries backed by the native document-start observer', async () => {
        const navigated: string[] = [];
        const daemonActions: string[] = [];
        const windowObj = {
            __MCP__: {},
            __happierPersonalHomeQaForbiddenSurface: {
                state: { documentStart: true, seen: false },
            },
            location: { pathname: '/' },
            history: { pushState: (_state: unknown, _title: string, path: string) => navigated.push(path) },
            dispatchEvent: () => true,
            PopStateEvent: class { constructor(public readonly type: string) {} },
        } as unknown as typeof globalThis;
        const documentObj = {
            readyState: 'loading',
            documentElement: {},
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            runPersonalHomeDaemonQaTask: async (action) => {
                daemonActions.push(action);
                return { ok: true, data: { daemonRunning: action === 'status' } };
            },
        });

        const mcp = (windowObj as unknown as { __MCP__?: Record<string, (...args: unknown[]) => unknown> }).__MCP__;
        expect(mcp?.readPersonalHomeBootstrapQaObservation()).toEqual({
            installedAtDocumentStart: true,
            seenForbiddenOnboarding: false,
        });
        (windowObj as unknown as { __happierPersonalHomeQaForbiddenSurface: { state: { seen: boolean } } })
            .__happierPersonalHomeQaForbiddenSurface.state.seen = true;
        expect(mcp?.readPersonalHomeBootstrapQaObservation()).toEqual({
            installedAtDocumentStart: true,
            seenForbiddenOnboarding: true,
        });
        expect(mcp?.navigateHappierQaPath('/settings/server')).toEqual({ ok: true, pathname: '/settings/server' });
        expect(navigated).toEqual(['/settings/server']);
        await expect(mcp?.readPersonalHomeDaemonQaStatus()).resolves.toEqual({ ok: true, data: { daemonRunning: true } });
        expect(daemonActions).toEqual(['status']);
    });

    it('installs a deterministic desktop-overlay QA seed helper for canonical proof states', async () => {
        const seededModes: string[] = [];
        const windowObj = {
            __MCP__: {},
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            seedDesktopOverlayQaState: async (mode) => {
                seededModes.push(mode);
                return {
                    ok: true,
                    mode,
                    cardKind: mode,
                };
            },
        });

        const result = await (
            windowObj as unknown as {
                __MCP__?: {
                    seedDesktopActivityOverlayQaState?: (mode: unknown) => Promise<{ ok: boolean; mode?: string }>;
                };
            }
        ).__MCP__?.seedDesktopActivityOverlayQaState?.('permission_request');

        expect(result).toMatchObject({
            ok: true,
            mode: 'permission_request',
        });
        expect(seededModes).toEqual(['permission_request']);
    });

    it('pins desktop-overlay QA seed state without repeatedly churning the proof payload', async () => {
        vi.useFakeTimers();

        const seededModes: string[] = [];
        const windowObj = {
            __MCP__: {},
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            seedDesktopOverlayQaState: async (mode) => {
                seededModes.push(mode);
                return {
                    ok: true,
                    mode,
                    cardKind: mode,
                };
            },
        });

        await (
            windowObj as unknown as {
                __MCP__?: {
                    seedDesktopActivityOverlayQaState?: (mode: unknown) => Promise<{ ok: boolean; mode?: string }>;
                };
            }
        ).__MCP__?.seedDesktopActivityOverlayQaState?.('quota_summary');

        await vi.advanceTimersByTimeAsync(350);

        expect(seededModes.length).toBe(1);
        expect(new Set(seededModes)).toEqual(new Set(['quota_summary']));
    });

    it('stops the previous desktop-overlay QA seed pin before pinning a new proof state', async () => {
        vi.useFakeTimers();

        const seededModes: string[] = [];
        const windowObj = {
            __MCP__: {},
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            seedDesktopOverlayQaState: async (mode) => {
                seededModes.push(mode);
                return {
                    ok: true,
                    mode,
                    cardKind: mode,
                };
            },
        });

        const mcp = (
            windowObj as unknown as {
                __MCP__?: {
                    seedDesktopActivityOverlayQaState?: (mode: unknown) => Promise<{ ok: boolean; mode?: string }>;
                };
            }
        ).__MCP__;

        await mcp?.seedDesktopActivityOverlayQaState?.('permission_request');
        await mcp?.seedDesktopActivityOverlayQaState?.('user_question');
        await vi.advanceTimersByTimeAsync(250);

        expect(seededModes).toContain('permission_request');
        expect(seededModes.at(-1)).toBe('user_question');
        expect(seededModes).toEqual(['permission_request', 'user_question']);
    });

    it('re-syncs a pinned desktop-overlay QA seed until native state reports the seeded card', async () => {
        const moduleExports = await import('./installTauriMcpWebviewDriverScripts');
        const waitForSeedState = (moduleExports as {
            waitForDesktopOverlayQaSeedState?: unknown;
        }).waitForDesktopOverlayQaSeedState;
        expect(typeof waitForSeedState).toBe('function');
        if (typeof waitForSeedState !== 'function') {
            return;
        }

        const syncCalls: unknown[] = [];
        const delays: number[] = [];
        let readCount = 0;
        const payload = {
            visible: true,
            expanded: true,
            policy: { enabled: true },
            window: {
                collapsed: { width: 336, height: 68 },
                expanded: { width: 408, height: 232 },
            },
            model: {
                visible: true,
                isExpanded: true,
                generatedAt: 1,
                collapsed: {
                    title: 'No active sessions',
                    primaryCardKind: 'idle_state',
                },
                expanded: {
                    rows: [],
                    cards: [{ id: 'idle', kind: 'idle_state', title: 'No active sessions' }],
                },
                window: {
                    collapsed: { width: 336, height: 68 },
                    expanded: { width: 408, height: 232 },
                },
            },
        };

        const result = await waitForSeedState({
            mode: 'idle',
            payload,
            attempts: 3,
            delayMs: 25,
            syncDesktopOverlayPayload: async (nextPayload: unknown) => {
                syncCalls.push(nextPayload);
            },
            readDesktopOverlayWindowState: async () => {
                readCount += 1;
                return readCount === 1
                    ? {
                        expanded: true,
                        model: {
                            collapsed: { primaryCardKind: 'multi_session_list' },
                            expanded: { cards: [{ kind: 'multi_session_list' }] },
                        },
                    }
                    : {
                        expanded: true,
                        model: {
                            collapsed: { primaryCardKind: 'idle_state' },
                            expanded: { cards: [{ kind: 'idle_state' }] },
                        },
                    };
            },
            wait: async (ms: number) => {
                delays.push(ms);
            },
        });

        expect(result).toMatchObject({
            ok: true,
            expectedCardKind: 'idle_state',
            observedCardKind: 'idle_state',
        });
        expect(syncCalls).toHaveLength(2);
        expect(delays).toEqual([25]);
    });

    it('maybeInstallTauriMcpBridge installs scripts only on desktop', () => {
        const element = { tagName: 'BUTTON' } as unknown as Element;
        const reverseRefs = new Map<string, Element>([['e1', element]]);
        const windowObj = {
            __MCP__: {
                reverseRefs,
            },
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => element,
            querySelectorAll: () => [element],
            evaluate: () => ({ singleNodeValue: element, snapshotLength: 1, snapshotItem: () => element }),
        } as unknown as Document;

        maybeInstallTauriMcpBridge({ isDesktopShell: false, windowObj, documentObj });
        expect((windowObj as unknown as { __MCP__?: { resolveRef?: unknown } }).__MCP__?.resolveRef).toBeUndefined();

        maybeInstallTauriMcpBridge({ isDesktopShell: true, windowObj, documentObj });
        expect(typeof (windowObj as unknown as { __MCP__?: { resolveRef?: unknown } }).__MCP__?.resolveRef).toBe('function');
    });

    it('installs no QA driver surface in a production desktop build', () => {
        const element = { tagName: 'BUTTON' } as unknown as Element;
        const windowObj = {
            __MCP__: { reverseRefs: new Map<string, Element>([['e1', element]]) },
        } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => element,
            querySelectorAll: () => [element],
            evaluate: () => ({ singleNodeValue: element, snapshotLength: 1, snapshotItem: () => element }),
        } as unknown as Document;

        maybeInstallTauriMcpBridge({ isDesktopShell: true, isDevBuild: false, windowObj, documentObj });

        // Every command this bridge publishes drives real machine state — a five-minute hold on a
        // durable Personal Home bootstrap mutation, stopping the daemon, uninstalling the runtime.
        // None of them may exist in a shipped desktop build.
        const mcp = (windowObj as unknown as {
            __MCP__?: Record<string, unknown>;
        }).__MCP__ ?? {};
        for (const command of [
            'resolveRef',
            'applyHappierLocalSettings',
            'controlPersonalHomeBootstrapQaPause',
            'uninstallPersonalHomeRuntimeForQa',
            'stopPersonalHomeDaemonForQa',
            'readPersonalHomeDaemonQaStatus',
            'seedDesktopActivityOverlayQaState',
        ]) {
            expect(mcp[command]).toBeUndefined();
        }
    });

    it('exposes the checked-in bootstrap mutation pause and the canonical uninstall operation for loaded QA', async () => {
        const { controlPersonalHomeBootstrapQaMutationPause } = await import(
            '@/components/personalHome/bootstrap/personalHomeBootstrapQaMutationPause'
        );
        const windowObj = { __MCP__: {} } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;
        let uninstallCalls = 0;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            uninstallPersonalHomeRuntimeQaTask: async () => {
                uninstallCalls += 1;
                return true;
            },
        });

        const mcp = (windowObj as unknown as {
            __MCP__?: {
                controlPersonalHomeBootstrapQaPause?: (request: unknown) => Record<string, unknown>;
                uninstallPersonalHomeRuntimeForQa?: () => Promise<Record<string, unknown>>;
            };
        }).__MCP__;

        // The hook drives the canonical pause owner rather than keeping its own QA state.
        expect(mcp?.controlPersonalHomeBootstrapQaPause?.({
            action: 'arm',
            kind: 'relay.runtime.installOrUpdate.v1',
            ordinal: 2,
            ttlMs: 5_000,
        })).toMatchObject({ ok: true, armed: { kind: 'relay.runtime.installOrUpdate.v1', ordinal: 2 } });
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'read' })).toMatchObject({
            armed: { kind: 'relay.runtime.installOrUpdate.v1', ordinal: 2 },
        });
        expect(mcp?.controlPersonalHomeBootstrapQaPause?.({ action: 'nope' }))
            .toMatchObject({ ok: false, reason: 'invalid-action' });

        // The uninstall boundary exists for the paused destructive-arbitration journey, so it runs
        // while that arm is live and reaches the canonical operation exactly once.
        await expect(mcp?.uninstallPersonalHomeRuntimeForQa?.()).resolves.toEqual({ ok: true });
        expect(uninstallCalls).toBe(1);

        expect(mcp?.controlPersonalHomeBootstrapQaPause?.({ action: 'release' }))
            .toMatchObject({ ok: true, armed: null, held: null });
    });

    it('keeps the canonical uninstall boundary inert until the checked-in pause is armed', async () => {
        const windowObj = { __MCP__: {} } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;
        let uninstallCalls = 0;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            uninstallPersonalHomeRuntimeQaTask: async () => {
                uninstallCalls += 1;
                return true;
            },
        });

        const mcp = (windowObj as unknown as {
            __MCP__?: { uninstallPersonalHomeRuntimeForQa?: () => Promise<Record<string, unknown>> };
        }).__MCP__;
        // An ordinary desktop shell installs this bridge, so an unarmed call must never reach the
        // real runtime uninstall; Settings stays the only product owner of that operation.
        await expect(mcp?.uninstallPersonalHomeRuntimeForQa?.()).resolves.toEqual({
            ok: false,
            reason: 'qa-pause-not-armed',
        });
        expect(uninstallCalls).toBe(0);
    });

    it('reports a failed canonical uninstall instead of self-attesting success', async () => {
        const { controlPersonalHomeBootstrapQaMutationPause } = await import(
            '@/components/personalHome/bootstrap/personalHomeBootstrapQaMutationPause'
        );
        const windowObj = { __MCP__: {} } as unknown as typeof globalThis;
        const documentObj = {
            querySelector: () => null,
            querySelectorAll: () => [],
            evaluate: () => ({ singleNodeValue: null, snapshotLength: 0, snapshotItem: () => null }),
        } as unknown as Document;

        installTauriMcpWebviewDriverScripts({
            windowObj,
            documentObj,
            uninstallPersonalHomeRuntimeQaTask: async () => {
                throw new Error('Runtime uninstall did not confirm completion.');
            },
        });

        const mcp = (windowObj as unknown as {
            __MCP__?: { uninstallPersonalHomeRuntimeForQa?: () => Promise<Record<string, unknown>> };
        }).__MCP__;
        controlPersonalHomeBootstrapQaMutationPause({
            action: 'arm',
            kind: 'relay.runtime.installOrUpdate.v1',
            ordinal: 1,
            ttlMs: 5_000,
        });
        await expect(mcp?.uninstallPersonalHomeRuntimeForQa?.()).resolves.toEqual({
            ok: false,
            reason: 'Runtime uninstall did not confirm completion.',
        });
        controlPersonalHomeBootstrapQaMutationPause({ action: 'release' });
    });
});
