import type { StorageState } from '@/sync/store/types';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockRequest,
    mockResolveContext,
    mockRuntimeFetchWithServerReachability,
    mockStorageState,
    mockActiveServerSnapshot,
    mockInvalidateSessionListSnapshot,
} = vi.hoisted(() => ({
    mockRequest: vi.fn(),
    mockResolveContext: vi.fn(),
    mockRuntimeFetchWithServerReachability: vi.fn(),
    mockInvalidateSessionListSnapshot: vi.fn(),
    mockActiveServerSnapshot: {
        serverId: 'server-a',
        serverUrl: 'https://active.example',
    },
    mockStorageState: {
        profileScope: null as StorageState['profileScope'],
        sessions: {} as StorageState['sessions'],
        sessionListRowsByServerId: {} as StorageState['sessionListRowsByServerId'],
        ordinarySessionListMembershipByServerId: {} as StorageState['ordinarySessionListMembershipByServerId'],
        sessionListIndexByServerId: {} as StorageState['sessionListIndexByServerId'],
        concurrentSessionListCacheByServerId: {} as StorageState['concurrentSessionListCacheByServerId'],
        settings: {
            schemaVersion: 1,
            sessionListActiveGroupingV1: 'project',
            sessionListInactiveGroupingV1: 'date',
        } as StorageState['settings'],
        machineListByServerId: {} as StorageState['machineListByServerId'],
        applySessions: vi.fn(),
        applyServerScopedSessionListRowPatches: vi.fn((serverId: string, patches: Array<{ sessionId: string; patch: Partial<SessionListRenderableSession> }>) => {
            const previousRows = mockStorageState.sessionListRowsByServerId[serverId] ?? {};
            const nextRows = { ...previousRows };
            for (const { sessionId, patch } of patches) {
                const previous = nextRows[sessionId];
                if (previous) nextRows[sessionId] = { ...previous, ...patch };
            }
            mockStorageState.sessionListRowsByServerId = {
                ...mockStorageState.sessionListRowsByServerId,
                [serverId]: nextRows,
            };
            mockStorageState.sessionListIndexByServerId = {
                ...mockStorageState.sessionListIndexByServerId,
            };
        }),
        setState: vi.fn((updater: (state: any) => any) => {
            const nextState = updater(mockStorageState as any);
            Object.assign(mockStorageState, nextState);
        }),
    },
}));

const actionSettingsBoundary = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/sync/sync', () => ({
    sync: { invalidateSessionListSnapshot: mockInvalidateSessionListSnapshot },
}));

vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        request: mockRequest,
        disconnect: vi.fn(),
    },
}));

vi.mock(
    '@/sync/runtime/orchestration/serverScopedRpc/resolveServerAccountRequestContext',
    () => ({
        resolveServerAccountRequestContext: async (params: Readonly<{ serverId?: string | null; preferScoped?: boolean }>) => {
            const result = await mockResolveContext(params);
            if (params.preferScoped !== true || result?.scope !== 'active') return result;
            return {
                scope: 'scoped',
                timeoutMs: result.timeoutMs ?? 1000,
                targetServerId: result.targetServerId ?? params.serverId ?? mockActiveServerSnapshot.serverId,
                targetServerUrl: result.targetServerUrl ?? mockActiveServerSnapshot.serverUrl,
                targetAccountId: mockStorageState.profileScope?.accountId ?? 'account-a',
                token: result.token ?? 'tok',
                encryption: result.encryption ?? null,
            };
        },
    }),
);

vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: mockRuntimeFetchWithServerReachability,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => mockActiveServerSnapshot,
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => {
        const scope = {
            serverId: mockActiveServerSnapshot.serverId,
            accountId: mockStorageState.profileScope?.accountId ?? 'account-a',
        };
        return {
            scope,
            isCurrent: () => mockActiveServerSnapshot.serverId === scope.serverId
                && (mockStorageState.profileScope?.accountId ?? 'account-a') === scope.accountId,
            onRetire: () => ({ dispose: () => undefined }),
        };
    },
}));

vi.mock('../actions/actionAccountContext', () => ({
    captureActionAccountContext: vi.fn(async (serverId: string) => ({
        serverId,
        accountId: mockStorageState.profileScope?.accountId ?? 'account-a',
        credentials: { token: 'unused' },
        accountMode: 'plain' as const,
        request: vi.fn(),
        assertCurrent: () => undefined,
        dispose: () => undefined,
        readSettings: async () => actionSettingsBoundary.current,
        readLiveSettings: () => null,
        runPrepared: async <T>(run: () => Promise<T>) => await run(),
        fetchArtifact: vi.fn(),
        createArtifact: vi.fn(),
        updateArtifact: vi.fn(),
    })),
}));

vi.mock('@/sync/domains/state/storage', () => ({
    storage: {
        getState: () => mockStorageState,
        getInitialState: () => mockStorageState,
        setState: (updater: (state: typeof mockStorageState) => typeof mockStorageState) =>
            mockStorageState.setState(updater),
        subscribe: () => () => undefined,
        destroy: () => undefined,
    },
}));

import { resetSessionSurfaceVisibilityForTests, setFocusedSessionId } from '../../domains/session/sessionSurfaceVisibility';
import {
    beginSessionViewingActivation,
    resetSessionManualUnreadHoldsForTests,
    shouldSuppressAutomaticMarkViewed,
} from '../../domains/session/readState/sessionManualUnreadHold';
import { sessionSetManualReadStateWithServerScope } from '../sessionReadState';

function makeResponse(opts: Readonly<{ ok: boolean; status?: number; json?: unknown; text?: string }>) {
    return {
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 500),
        json: async () => opts.json ?? {},
        text: async () => opts.text ?? '',
        headers: new Map(),
    } as any;
}

type TestSession = StorageState['sessions'][string]
    & Omit<SessionListRenderableSession, 'metadata'>
    & { metadata: StorageState['sessions'][string]['metadata'] };

function makeSession(overrides: Partial<TestSession> = {}): TestSession {
    const session: TestSession = {
        id: 'sid-1',
        seq: 7,
        lastViewedSessionSeq: 7,
        createdAt: 1,
        active: false,
        activeAt: 1,
        archivedAt: null,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: 1,
        updatedAt: 100,
        ...overrides,
    };
    return session;
}

describe('sessionSetManualReadStateWithServerScope', () => {
    beforeEach(() => {
        mockActiveServerSnapshot.serverId = 'server-a';
        mockActiveServerSnapshot.serverUrl = 'https://active.example';
        mockRequest.mockReset();
        mockResolveContext.mockReset();
        mockRuntimeFetchWithServerReachability.mockReset();
        mockInvalidateSessionListSnapshot.mockReset();
        mockRuntimeFetchWithServerReachability.mockImplementation(async (params: Readonly<{ url: string; init?: RequestInit }>) => {
            const path = new URL(params.url).pathname;
            return await mockRequest(path, params.init);
        });
        mockStorageState.profileScope = null;
        mockStorageState.sessions = {};
        mockStorageState.sessionListRowsByServerId = {};
        mockStorageState.ordinarySessionListMembershipByServerId = {};
        mockStorageState.sessionListIndexByServerId = {};
        mockStorageState.concurrentSessionListCacheByServerId = {};
        mockStorageState.machineListByServerId = {};
        mockStorageState.applySessions.mockReset();
        mockStorageState.applyServerScopedSessionListRowPatches.mockClear();
        mockStorageState.setState.mockClear();
        actionSettingsBoundary.current = {};
        resetSessionManualUnreadHoldsForTests();
        resetSessionSurfaceVisibilityForTests();
    });

    it('enters the shared Action policy before the existing domain transport', async () => {
        mockStorageState.sessions = { 'sid-1': makeSession() };
        actionSettingsBoundary.current = {
            actionsSettingsV1: {
                v: 1,
                actions: {
                    'session.read_state.set': { enabled: false },
                },
            },
        };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'read', lastViewedSessionSeq: 7, didChange: true },
        }));

        await expect(sessionSetManualReadStateWithServerScope('sid-1', 'read', { serverId: 'server-a' }))
            .resolves.toEqual({ success: false, message: 'action_disabled' });
        expect(mockRequest).not.toHaveBeenCalled();
        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
    });

    it('updates the private viewer frontier without rewriting owner metadata', async () => {
        const metadata = { path: '', host: '', readStateV1: { v: 1 as const, sessionSeq: 7, pendingActivityAt: 0, updatedAt: 1 } };
        mockStorageState.sessions = {
            'sid-1': makeSession({ metadata, viewer: {
                readState: { state: 'tracking', lastViewedSessionSeq: 7, unreadSince: null },
                relevance: { relevant: true, reasons: ['owned_by_me'] },
                attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' },
                follow: { follows: false, notificationLevel: null },
                notification: { level: 'important', source: 'owner' },
            } }),
        };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockResolvedValue(makeResponse({ ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: 6, didChange: true, viewer: { ...mockStorageState.sessions['sid-1'].viewer, readState: { state: 'tracking', lastViewedSessionSeq: 6, unreadSince: 123 } } },
        }));
        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });
        const next = mockStorageState.applySessions.mock.calls[0]?.[0]?.[0];
        expect(next.viewer.readState).toEqual({ state: 'tracking', lastViewedSessionSeq: 6, unreadSince: 123 });
        expect(next.metadata).toEqual(metadata);
    });

    it('applies canonical attention from the private viewer response', async () => {
        const viewer = {
            readState: { state: 'tracking' as const, lastViewedSessionSeq: 7, unreadSince: null },
            relevance: { relevant: true, reasons: ['owned_by_me' as const] },
            attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' as const },
            follow: { follows: false as const, notificationLevel: null },
            notification: { level: 'important' as const, source: 'owner' as const },
        };
        mockStorageState.sessions = { 'sid-1': makeSession({ viewer: { ...viewer, attention: { ...viewer.attention, needsAttention: true, reasons: ['unread'], primary: 'unread' } } }) };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockResolvedValue(makeResponse({ ok: true, json: {
            success: true, state: 'read', lastViewedSessionSeq: 7, didChange: true, viewer,
        } }));
        await sessionSetManualReadStateWithServerScope('sid-1', 'read', { serverId: 'server-a' });
        expect(mockStorageState.applySessions.mock.calls[0]?.[0]?.[0]?.viewer).toEqual(viewer);
    });

    it('does not retarget a response when the focused Home changes during the request', async () => {
        const sourceRows = { 'sid-1': makeSession({ hasUnreadMessages: false }) };
        mockStorageState.concurrentSessionListCacheByServerId = {
            'server-a': { serverName: 'A' },
        };
        mockStorageState.sessionListRowsByServerId = { 'server-a': sourceRows };
        mockStorageState.sessions = { 'sid-1': makeSession({ lastViewedSessionSeq: 1 }) };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockImplementation(async () => {
            mockActiveServerSnapshot.serverId = 'server-b';
            return makeResponse({ ok: true, json: {
                success: true, state: 'unread', lastViewedSessionSeq: 6, didChange: true,
            } });
        });
        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });
        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
        expect(mockStorageState.sessionListRowsByServerId['server-a']?.['sid-1']?.lastViewedSessionSeq).toBe(6);
    });

    it('refuses manual reads for an untracked viewer without a request or local enrollment', async () => {
        mockStorageState.sessions = { 'sid-1': makeSession({ viewer: {
            readState: { state: 'not_started' },
            relevance: { relevant: false, reasons: [] },
            attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' },
            follow: { follows: false, notificationLevel: null },
            notification: { level: 'none', source: 'none' },
        } }) };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockResolvedValue(makeResponse({ ok: true, json: { success: true, state: 'read', lastViewedSessionSeq: 7 } }));
        const response = await sessionSetManualReadStateWithServerScope('sid-1', 'read', { serverId: 'server-a' });
        expect(response).toEqual({ success: false, message: 'session_not_tracked' });
        expect(mockRequest).not.toHaveBeenCalled();
        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
    });

    it('does not restore tracking from a delayed read response after Unfollow', async () => {
        const quiet = {
            readState: { state: 'not_started' as const },
            relevance: { relevant: false, reasons: [] },
            attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' as const },
            follow: { follows: false as const, notificationLevel: null },
            notification: { level: 'none' as const, source: 'none' as const },
        };
        const tracking = { ...quiet, readState: { state: 'tracking' as const, lastViewedSessionSeq: 7, unreadSince: null } };
        mockStorageState.sessions = { 'sid-1': makeSession({ viewer: tracking }) };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockImplementation(async () => {
            mockStorageState.sessions['sid-1'] = makeSession({ viewer: quiet });
            return makeResponse({ ok: true, json: { success: true, state: 'read', lastViewedSessionSeq: 7, viewer: tracking } });
        });
        const result = await sessionSetManualReadStateWithServerScope('sid-1', 'read', { serverId: 'server-a' });
        expect(result).toEqual({ success: false, message: 'session_not_tracked' });
        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
    });

    it('refreshes a no-longer-tracked viewer on conflict without reporting a read mutation', async () => {
        const viewer = {
            readState: { state: 'not_started' as const },
            relevance: { relevant: false, reasons: [] },
            attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' as const },
            follow: { follows: false as const, notificationLevel: null },
            notification: { level: 'none' as const, source: 'none' as const },
        };
        mockStorageState.sessions = { 'sid-1': makeSession({ viewer: {
            ...viewer, readState: { state: 'tracking', lastViewedSessionSeq: 0, unreadSince: 1 },
        } }) };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockResolvedValue(makeResponse({ ok: false, status: 409,
            json: { error: 'session_not_tracked', viewer }, text: 'session_not_tracked',
        }));
        const result = await sessionSetManualReadStateWithServerScope('sid-1', 'read', { serverId: 'server-a' });
        expect(result.success).toBe(false);
        expect(mockStorageState.applySessions.mock.calls[0]?.[0]?.[0]?.viewer).toEqual(viewer);
    });

    it('does not apply a private response after switching Accounts on the same Home', async () => {
        mockStorageState.profileScope = { serverId: 'server-a', accountId: 'alice' };
        mockStorageState.sessions = { 'sid-1': makeSession() };
        mockResolveContext.mockResolvedValue({ scope: 'active', targetServerId: 'server-a' });
        mockRequest.mockImplementation(async () => {
            mockStorageState.profileScope = { serverId: 'server-a', accountId: 'bob' };
            return makeResponse({ ok: true, json: { success: true, state: 'unread', lastViewedSessionSeq: 6, didChange: true } });
        });
        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });
        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
    });

    it('does not send through a different Home after request scope resolution', async () => {
        mockResolveContext.mockImplementation(async () => {
            mockActiveServerSnapshot.serverId = 'server-b';
            return { scope: 'active' };
        });
        mockRequest.mockResolvedValue(makeResponse({ ok: true, json: { success: true, state: 'read', lastViewedSessionSeq: 7 } }));
        const result = await sessionSetManualReadStateWithServerScope('sid-1', 'read', { serverId: 'server-a' });
        expect(result.success).toBe(false);
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('uses the exact-Home scoped transport and applies the returned cursor after success', async () => {
        mockStorageState.sessions = {
            'sid-1': makeSession({ lastViewedSessionSeq: 7 }),
        };
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: 6, didChange: true },
        }));

        const res = await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });

        expect(res).toEqual({ success: true, readState: 'unread', lastViewedSessionSeq: 6, didChange: true });
        expect(mockRuntimeFetchWithServerReachability).toHaveBeenCalledWith(expect.objectContaining({
            serverUrl: 'https://active.example',
            token: 'tok',
            url: 'https://active.example/v2/sessions/sid-1/read-state',
            init: expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ state: 'unread' }),
                signal: expect.any(AbortSignal),
            }),
        }));
        expect(mockStorageState.applySessions).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 'sid-1',
                lastViewedSessionSeq: 6,
                updatedAt: expect.any(Number),
            }),
        ]);
    });

    it('uses runtimeFetchWithServerReachability for a scoped server', async () => {
        mockResolveContext.mockResolvedValue({
            scope: 'scoped',
            targetServerUrl: 'https://scoped.example',
            targetServerId: 'server-b',
            token: 'tok-scoped',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRuntimeFetchWithServerReachability.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'read', lastViewedSessionSeq: 7, didChange: false },
        }));

        const res = await sessionSetManualReadStateWithServerScope('sid-2', 'read', { serverId: 'server-b' });

        expect(res).toEqual({ success: true, readState: 'read', lastViewedSessionSeq: 7, didChange: false });
        expect(mockRuntimeFetchWithServerReachability).toHaveBeenCalledWith(
            expect.objectContaining({
                serverUrl: 'https://scoped.example',
                token: 'tok-scoped',
                url: 'https://scoped.example/v2/sessions/sid-2/read-state',
                timeoutMs: 1000,
                init: expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ state: 'read' }),
                }),
            }),
        );
        const scopedHeaders = new Headers(mockRuntimeFetchWithServerReachability.mock.calls[0]?.[0]?.init?.headers);
        expect(scopedHeaders.get('Authorization')).toBe('Bearer tok-scoped');
        expect(scopedHeaders.get('Content-Type')).toBe('application/json');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('keeps a nullable cursor without maintaining legacy metadata after success', async () => {
        mockStorageState.sessions = {
            'sid-1': makeSession({
                lastViewedSessionSeq: null,
                metadata: {
                    path: '',
                    host: '',
                    readStateV1: { v: 1, sessionSeq: 7, pendingActivityAt: 0, updatedAt: 100 },
                },
            }),
        };
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: null, didChange: false },
        }));

        const res = await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });

        expect(res).toEqual({ success: true, readState: 'unread', lastViewedSessionSeq: null, didChange: false });
        expect(mockStorageState.applySessions).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 'sid-1',
                lastViewedSessionSeq: null,
                metadata: expect.objectContaining({
                    readStateV1: expect.objectContaining({ sessionSeq: 7 }),
                }),
            }),
        ]);
    });

    it('updates direct-session attention metadata when marking unread', async () => {
        mockStorageState.sessions = {
            'sid-1': makeSession({
                seq: 0,
                lastViewedSessionSeq: 0,
                metadata: {
                    path: '',
                    host: '',
                    externalSessionV1: {
                        v: 1,
                        agentId: 'codex',
                        machineId: 'machine-1',
                        remoteSessionId: 'remote-1',
                        source: { kind: 'codexHome', home: 'user' },
                    },
                    externalSessionAttentionV1: {
                        v: 1,
                        observedProgressToken: '2:message',
                        viewedProgressToken: '2:message',
                    },
                },
            }),
        };
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: 0, didChange: false },
        }));

        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });

        const appliedSession = mockStorageState.applySessions.mock.calls[0]?.[0]?.[0];
        expect(appliedSession?.metadata?.externalSessionAttentionV1).toEqual({
            v: 1,
            observedProgressToken: '2:message',
        });
    });

    it('patches renderable unread state when only a list renderable is cached', async () => {
        mockStorageState.sessionListRowsByServerId = {
            'server-a': { 'sid-1': makeSession({ hasUnreadMessages: false }) },
        };
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: 6, didChange: true },
        }));

        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });

        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
        expect(mockStorageState.applyServerScopedSessionListRowPatches).toHaveBeenCalledWith('server-a', [
            { sessionId: 'sid-1', patch: { hasUnreadMessages: true, lastViewedSessionSeq: 6 } },
        ]);
    });

    it('patches renderable cursors even when the unread flag is unchanged', async () => {
        mockStorageState.sessionListRowsByServerId = {
            'server-a': { 'sid-1': makeSession({ hasUnreadMessages: false, lastViewedSessionSeq: 6 }) },
        };
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'read', lastViewedSessionSeq: 7, didChange: true },
        }));

        await sessionSetManualReadStateWithServerScope('sid-1', 'read', { serverId: 'server-a' });

        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
        expect(mockStorageState.applyServerScopedSessionListRowPatches).toHaveBeenCalledWith('server-a', [
            { sessionId: 'sid-1', patch: { hasUnreadMessages: false, lastViewedSessionSeq: 7 } },
        ]);
    });

    it('does not rewrite legacy metadata when patching a renderable-only unread null cursor', async () => {
        mockStorageState.sessionListRowsByServerId = {
            'server-a': { 'sid-1': makeSession({
                hasUnreadMessages: false,
                lastViewedSessionSeq: null,
                metadata: {
                    path: '',
                    host: '',
                    readStateV1: { v: 1, sessionSeq: 7, pendingActivityAt: 0, updatedAt: 100 },
                },
            }) },
        };
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: null, didChange: false },
        }));

        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });

        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
        expect(mockStorageState.applyServerScopedSessionListRowPatches).toHaveBeenCalledWith('server-a', [
            {
                sessionId: 'sid-1',
                patch: expect.objectContaining({
                    hasUnreadMessages: true,
                    lastViewedSessionSeq: null,
                }),
            },
        ]);
    });

    it('patches the non-active server cache without mutating active-server session state', async () => {
        mockStorageState.sessions = {
            'sid-1': makeSession({ lastViewedSessionSeq: 7 }),
        };
        const serverBRows: Record<string, SessionListRenderableSession> = {
            'sid-1': {
                id: 'sid-1',
                seq: 7,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                pendingCount: 0,
                pendingVersion: 0,
                metadataVersion: 1,
                agentStateVersion: 0,
                metadata: null,
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
                hasUnreadMessages: false,
            },
        };
        mockStorageState.concurrentSessionListCacheByServerId = {
            'server-b': {
                serverName: 'Server B',
            },
        };
        mockStorageState.sessionListRowsByServerId = {
            'server-b': serverBRows,
        };
        mockStorageState.sessionListIndexByServerId = {
            'server-b': [{ type: 'session', sessionId: 'sid-1' }] satisfies SessionListIndexItem[],
        };
        const previousIndex = mockStorageState.sessionListIndexByServerId['server-b'];
        mockResolveContext.mockResolvedValue({
            scope: 'scoped',
            targetServerUrl: 'https://scoped.example',
            targetServerId: 'server-b',
            token: 'tok-scoped',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRuntimeFetchWithServerReachability.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: 6, didChange: true },
        }));

        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-b' });

        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
        expect(mockStorageState.sessionListRowsByServerId['server-b']?.['sid-1']?.hasUnreadMessages).toBe(true);
        expect(mockStorageState.sessionListRowsByServerId['server-b']?.['sid-1']?.lastViewedSessionSeq).toBe(6);
        expect(mockStorageState.sessionListIndexByServerId['server-b']).not.toBe(previousIndex);
    });

    it('preserves legacy metadata when patching a non-active cache unread null cursor', async () => {
        const serverBRows: Record<string, SessionListRenderableSession> = {
            'sid-1': {
                id: 'sid-1',
                seq: 7,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                pendingCount: 0,
                pendingVersion: 0,
                metadataVersion: 1,
                agentStateVersion: 0,
                metadata: {
                    path: '',
                    host: '',
                    readStateV1: { v: 1, sessionSeq: 7, pendingActivityAt: 0, updatedAt: 100 },
                },
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
                hasUnreadMessages: false,
                lastViewedSessionSeq: null,
            },
        };
        mockStorageState.concurrentSessionListCacheByServerId = {
            'server-b': {
                serverName: 'Server B',
            },
        };
        mockStorageState.sessionListRowsByServerId = {
            'server-b': serverBRows,
        };
        mockResolveContext.mockResolvedValue({
            scope: 'scoped',
            targetServerUrl: 'https://scoped.example',
            targetServerId: 'server-b',
            token: 'tok-scoped',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRuntimeFetchWithServerReachability.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: null, didChange: false },
        }));

        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-b' });

        expect(mockStorageState.sessionListRowsByServerId['server-b']?.['sid-1']?.metadata?.readStateV1?.sessionSeq).toBe(7);
    });

    it('registers an active-view hold after marking the focused session unread', async () => {
        mockStorageState.sessions = {
            'sid-1': makeSession({ lastViewedSessionSeq: 7 }),
        };
        const activationId = beginSessionViewingActivation('sid-1');
        setFocusedSessionId('sid-1');
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: true,
            json: { success: true, state: 'unread', lastViewedSessionSeq: 6, didChange: true },
        }));

        await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });

        expect(shouldSuppressAutomaticMarkViewed({ sessionId: 'sid-1', sessionSeq: 7, activationId })).toBe(true);
    });

    it('returns a structured failure without applying local state', async () => {
        mockStorageState.sessions = {
            'sid-1': makeSession(),
        };
        mockResolveContext.mockResolvedValue({
            scope: 'active',
            targetServerUrl: 'https://active.example',
            targetServerId: 'server-a',
            token: 'tok',
            timeoutMs: 1000,
            encryption: null,
        });
        mockRequest.mockResolvedValue(makeResponse({
            ok: false,
            status: 403,
            text: 'Forbidden',
        }));

        const res = await sessionSetManualReadStateWithServerScope('sid-1', 'unread', { serverId: 'server-a' });

        expect(res).toEqual({ success: false, message: 'forbidden' });
        expect(mockStorageState.applySessions).not.toHaveBeenCalled();
    });
});
