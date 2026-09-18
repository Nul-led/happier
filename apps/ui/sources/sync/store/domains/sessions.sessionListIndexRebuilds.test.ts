import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSessionListRenderableFromSession, type SessionListRenderableSession } from '../../domains/session/listing/sessionListRenderable';
import { buildSessionListViewData } from '../../domains/session/listing/sessionListViewData';
import { buildSessionListIndexFromViewData } from '../../domains/sessionList/sessionListIndex';
import type { SessionListIndexItem } from '../../domains/sessionList/sessionListIndex';
import { getSessionStorageKind } from '../../domains/session/sessionStorageKind';
import type { ScmWorkingSnapshot, Session } from '../../domains/state/storageTypes';

const normalizeKnownProjectMachineIdMock = (value: unknown): string | null => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
};

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('../../domains/server/serverRuntime', () => ({
        getActiveServerSnapshot: () => ({ serverId: 'server-active', serverUrl: 'https://example.com', generation: 1 }),
    }));
});

function mockSessionPersistenceBoundaries(options?: { trackWarmCacheEntries?: boolean }): void {
    let lastWarmCacheEntries: Record<string, unknown> | null = null;
    const shouldTrackWarmCacheEntries = options?.trackWarmCacheEntries === true;
    const resolveWarmCacheAccountScope = vi.fn((fallback: string | null | undefined) => fallback ?? null);
    const peekSessionListWarmCacheEntries = shouldTrackWarmCacheEntries
        ? vi.fn(() => lastWarmCacheEntries)
        : vi.fn(() => null);
    const saveSessionListWarmCacheEntries = shouldTrackWarmCacheEntries
        ? vi.fn((serverId: string | null | undefined, accountId: string | null | undefined, entries: Record<string, unknown>) => {
            lastWarmCacheEntries = entries;
        })
        : vi.fn();
    vi.doMock('../../domains/state/persistence', () => ({
        loadProfile: vi.fn(() => ({ id: 'account_a' })),
        saveProfile: vi.fn(),
        loadSessionDrafts: vi.fn(() => ({})),
        loadSessionLastViewed: vi.fn(() => ({})),
        loadSessionModelModeUpdatedAts: vi.fn(() => ({})),
        loadSessionModelModes: vi.fn(() => ({})),
        loadSessionPermissionModeUpdatedAts: vi.fn(() => ({})),
        loadSessionPermissionModes: vi.fn(() => ({})),
        loadSessionActionDrafts: vi.fn(() => ({})),
        prepareSessionLocalStateScopeForActivation: vi.fn(),
        loadSessionReviewCommentsDrafts: vi.fn(() => ({})),
        loadWorkspaceReviewCommentsDrafts: vi.fn(() => ({})),
        saveSessionDrafts: vi.fn(),
        saveSessionLastViewed: vi.fn(),
        loadSettings: vi.fn(() => ({
            settings: {
                preferredLanguage: 'en',
            },
            version: null,
        })),
        loadLocalSettings: vi.fn(() => ({})),
        loadPurchases: vi.fn(() => ({})),
        saveSessionModelModeUpdatedAts: vi.fn(),
        saveSessionModelModes: vi.fn(),
        saveSessionPermissionModeUpdatedAts: vi.fn(),
        saveSessionPermissionModes: vi.fn(),
        saveSessionActionDrafts: vi.fn(),
        saveSessionReviewCommentsDrafts: vi.fn(),
        saveWorkspaceReviewCommentsDrafts: vi.fn(),
        saveLocalSettings: vi.fn(),
        savePurchases: vi.fn(),
        saveSettings: vi.fn(),
    }));
    vi.doMock('../../domains/state/warmCachePersistence', () => ({
        resolveWarmCacheAccountScope,
        peekSessionListWarmCacheEntries,
        saveSessionListWarmCacheEntries,
    }));
    vi.doMock('@/sync/domains/models/modelOptions', () => ({
    findModelOptionForEffectiveModelId: (options: any, effectiveModelId: any) =>
        options?.find?.((option: any) => option.value === effectiveModelId)
            ?? options?.find?.((option: any) => option.value === String(effectiveModelId ?? '').replace(/\[[^\]]*\]$/u, ''))
            ?? null,
        isModelSelectableForSession: vi.fn(() => true),
    }));
    vi.doMock('@/agents/catalog/catalog', () => ({
        AGENT_IDS: [],
        DEFAULT_AGENT_ID: 'openai',
        resolveAgentIdFromFlavor: vi.fn(() => null),
    }));
}

function createHarness(createSessionsDomain: any, initialState?: Record<string, unknown>) {
    let setCalls = 0;
    let state: any = {
        sessions: {},
        sessionListRowsByServerId: {},
        ordinarySessionListMembershipByServerId: {},
        archivedSessionListMembershipByServerId: {},
        sessionListIndexByServerId: {},
        concurrentSessionListCacheByServerId: {},
        sessionScmStatus: {},
        sessionLastViewed: {},
        sessionRepositoryTreeExpandedPathsBySessionId: {},
        reviewCommentsDraftsBySessionId: {},
        sessionActionDraftsByAddressKey: {},
        isDataReady: false,
        machines: {},
        machineDisplayById: {},
        sessionMessages: {},
        profile: { id: 'account_a' },
        settings: {},
        ...initialState,
    };

    const get = () => state;
    const set = (updater: any) => {
        setCalls += 1;
        const next = typeof updater === 'function' ? updater(state) : updater;
        state = { ...state, ...next };
    };

    const domain = createSessionsDomain({ get, set } as any);
    return { get, domain, getSetCalls: () => setCalls };
}

function replaceSessionListRows(domain: any, rows: SessionListRenderableSession[]): void {
    domain.applyServerScopedSessionListRows('server-active', rows, { source: 'ordinary', mode: 'replace' });
}

function patchActiveSessionListRows(domain: any, patches: unknown[]): void {
    domain.applyServerScopedSessionListRowPatches('server-active', patches);
}

function readSessionListIndexSessionIds(
    index: ReadonlyArray<SessionListIndexItem> | null | undefined,
): string[] {
    return (index ?? [])
        .filter((item): item is Extract<SessionListIndexItem, { type: 'session' }> => item.type === 'session')
        .map((item) => item.sessionId);
}

describe('sessions domain: sessionListIndex rebuild gating', () => {
    it('lazily registers loaded sessions before writing per-session project SCM snapshots', async () => {
        mockSessionPersistenceBoundaries();
        const { projectManager } = await import('../../runtime/orchestration/projectManager');
        projectManager.clear();

        const session = {
            id: 's1',
            serverId: 'server-active',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            archivedAt: null,
            metadata: { machineId: 'm1', host: 'h1', path: '/home/u/repo', homeDir: '/home/u' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        };
        const snapshot: ScmWorkingSnapshot = {
            projectKey: 'server-active:m1:/home/u/repo',
            fetchedAt: 123,
            repo: {
                isRepo: true,
                rootPath: '/home/u/repo',
                backendId: 'git',
                mode: '.git',
                worktrees: [{ path: '/home/u/repo', branch: 'main', isCurrent: true }],
            },
            branch: {
                head: 'main',
                upstream: null,
                ahead: 0,
                behind: 0,
                detached: false,
            },
            hasConflicts: false,
            entries: [],
            totals: {
                includedFiles: 0,
                pendingFiles: 0,
                untrackedFiles: 0,
                includedAdded: 0,
                includedRemoved: 0,
                pendingAdded: 0,
                pendingRemoved: 0,
            },
        };

        const { createSessionsDomain } = await import('./sessions');
        const { domain } = createHarness(createSessionsDomain, {
            sessions: { s1: session },
            machines: { m1: { id: 'm1', metadata: { homeDir: '/home/u' } } },
        });

        expect(projectManager.getProjectForSession('s1')).toBeNull();

        domain.updateSessionProjectScmSnapshot('s1', snapshot);

        expect(domain.getSessionProjectScmSnapshot('s1')).toBe(snapshot);
        expect(projectManager.getProjectForSession('s1')?.sessionIds).toEqual(['s1']);
    });

    it('does not notify storage when SCM snapshot refreshes only change fetchedAt', async () => {
        mockSessionPersistenceBoundaries();
        const { projectManager } = await import('../../runtime/orchestration/projectManager');
        projectManager.clear();

        const session = {
            id: 's1',
            serverId: 'server-active',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            archivedAt: null,
            metadata: { machineId: 'm1', host: 'h1', path: '/home/u/repo', homeDir: '/home/u' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        } satisfies Session;
        const snapshot: ScmWorkingSnapshot = {
            projectKey: 'server-active:m1:/home/u/repo',
            fetchedAt: 123,
            repo: {
                isRepo: true,
                rootPath: '/home/u/repo',
                backendId: 'git',
                mode: '.git',
                worktrees: [{ path: '/home/u/repo', branch: 'main', isCurrent: true }],
            },
            branch: {
                head: 'main',
                upstream: null,
                ahead: 0,
                behind: 0,
                detached: false,
            },
            hasConflicts: false,
            entries: [
                {
                    path: 'src/app.ts',
                    previousPath: null,
                    kind: 'modified',
                    includeStatus: 'modified',
                    pendingStatus: 'modified',
                    hasIncludedDelta: false,
                    hasPendingDelta: true,
                    stats: {
                        includedAdded: 0,
                        includedRemoved: 0,
                        pendingAdded: 1,
                        pendingRemoved: 1,
                        isBinary: false,
                    },
                },
            ],
            totals: {
                includedFiles: 0,
                pendingFiles: 1,
                untrackedFiles: 0,
                includedAdded: 0,
                includedRemoved: 0,
                pendingAdded: 1,
                pendingRemoved: 1,
            },
        };

        const { createSessionsDomain } = await import('./sessions');
        const { domain, getSetCalls } = createHarness(createSessionsDomain, {
            sessions: { s1: session },
            machines: { m1: { id: 'm1', metadata: { homeDir: '/home/u' } } },
        });

        domain.updateSessionProjectScmSnapshot('s1', snapshot);
        expect(getSetCalls()).toBe(1);

        domain.updateSessionProjectScmSnapshot('s1', {
            ...snapshot,
            fetchedAt: 456,
        });
        expect(getSetCalls()).toBe(1);

        const scope = { serverId: 'server-active', machineId: 'm1', rootPath: '/home/u/other-repo' };
        const workspaceSnapshot = {
            ...snapshot,
            projectKey: 'server-active:m1:/home/u/other-repo',
            repo: {
                ...snapshot.repo,
                rootPath: '/home/u/other-repo',
                worktrees: [{ path: '/home/u/other-repo', branch: 'main', isCurrent: true }],
            },
        } satisfies ScmWorkingSnapshot;

        domain.updateWorkspaceScmSnapshot(scope, workspaceSnapshot);
        expect(getSetCalls()).toBe(2);

        domain.updateWorkspaceScmSnapshot(scope, {
            ...workspaceSnapshot,
            fetchedAt: 789,
        });
        expect(getSetCalls()).toBe(2);
    });

    it('builds an empty sessionListIndex when the server snapshot returns zero sessions', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        expect(get().sessionListIndexByServerId?.['server-active']).toBeUndefined();

        replaceSessionListRows(domain, []);

        expect(Array.isArray(get().sessionListIndexByServerId?.['server-active'])).toBe(true);
        expect(get().sessionListIndexByServerId?.['server-active']?.length).toBe(0);
    });

    it('initializes the active-server sessionListIndex when a no-op patch arrives before the index exists', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        const session = {
            id: 's1',
            serverId: 'server-active',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: {
                name: 'Session',
                path: '/repo',
                host: 'host-1',
                machineId: 'm1',
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        } satisfies Session;
        replaceSessionListRows(domain, [
            buildSessionListRenderableFromSession(session),
        ]);
        get().sessionListIndexByServerId = {};

        patchActiveSessionListRows(domain, [
            { sessionId: 's1', patch: { pendingCount: (get().sessionListRowsByServerId['server-active'] ?? {}).s1.pendingCount } },
        ]);

        expect(Array.isArray(get().sessionListIndexByServerId?.['server-active'])).toBe(true);
        const activeServerIndex = get().sessionListIndexByServerId?.['server-active'] as ReadonlyArray<SessionListIndexItem> | undefined;
        expect(activeServerIndex?.some(
            (item) => item.type === 'session' && item.sessionId === 's1',
        )).toBe(true);
    });

    it('tracks the active-server sessionListIndex in sessionListIndexByServerId', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({ serverId: 'server-active', serverUrl: 'https://example.com', generation: 1 }),
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(Array.isArray(get().sessionListIndexByServerId?.['server-active'])).toBe(true);
    });

    it('reuses the server-scoped previous index when rebuilding the active server index', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn(), getProjectForSession: vi.fn(() => null) },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({ serverId: 'server-b', serverUrl: 'https://example.com', generation: 1 }),
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');

        const session = {
            id: 's1',
            serverId: 'server-b',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            archivedAt: null,
            metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as any;

        const precomputedRenderable = buildSessionListRenderableFromSession(session);
        const precomputedViewData = buildSessionListViewData(
            { [precomputedRenderable.id]: precomputedRenderable },
            {},
            {
                serverScope: { serverId: 'server-b' },
            },
        );
        const precomputedIndex = buildSessionListIndexFromViewData(precomputedViewData, null);

        let state: any = {
            sessions: {},
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: {},
            archivedSessionListMembershipByServerId: {},
            sessionListIndexByServerId: {
                'server-b': precomputedIndex,
            },
            concurrentSessionListCacheByServerId: {},
            sessionScmStatus: {},
            sessionLastViewed: {},
            sessionRepositoryTreeExpandedPathsBySessionId: {},
            reviewCommentsDraftsBySessionId: {},
            sessionActionDraftsByAddressKey: {},
            isDataReady: false,
            machines: {},
            machineDisplayById: {},
            sessionMessages: {},
            profile: { id: 'account_a' },
            settings: {},
        };

        const get = () => state;
        const set = (updater: any) => {
            const next = typeof updater === 'function' ? updater(state) : updater;
            state = { ...state, ...next };
        };

        const domain = createSessionsDomain({ get, set } as any);
        state = { ...domain, ...state };

        state.applySessions([session]);

        expect(state.sessionListIndexByServerId['server-b']).toBe(precomputedIndex);
    });

    it('does not call projectManager.updateSessions for non-project-structural session updates', async () => {
        const updateSessions = vi.fn();
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                metadata: { machineId: 'm1', host: 'h1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);
        expect(updateSessions).toHaveBeenCalledTimes(1);

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                archivedAt: null,
                metadata: { machineId: 'm1', host: 'h1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: { requests: {} },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);
        expect(updateSessions).toHaveBeenCalledTimes(1);
    });

    it('keeps the active-server sessionListIndex reference stable for non-structural applySessions updates', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries({ trackWarmCacheEntries: true });

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: { requests: {} },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
    });

    it('rebuilds inactive date-grouped sessionListIndex when updatedAt changes ordering', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries({ trackWarmCacheEntries: true });

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain, {
            settings: {
                sessionListInactiveGroupingV1: 'date',
            },
        });

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 100,
                meaningfulActivityAt: 100,
                active: false,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
            {
                id: 's2',
                serverId: 'server-active',
                seq: 1,
                createdAt: 2,
                updatedAt: 200,
                meaningfulActivityAt: 200,
                active: false,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(readSessionListIndexSessionIds(initialIndex)).toEqual(['s2', 's1']);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 2,
                createdAt: 1,
                updatedAt: 300,
                meaningfulActivityAt: 300,
                active: false,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const nextIndex = get().sessionListIndexByServerId['server-active'];
        expect(nextIndex).not.toBe(initialIndex);
        expect(readSessionListIndexSessionIds(nextIndex)).toEqual(['s1', 's2']);
    });

    it('reuses the previous renderable object for semantically identical applySessions refreshes', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries({ trackWarmCacheEntries: true });

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialRenderable = (get().sessionListRowsByServerId['server-active'] ?? {})['s1'];
        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(initialRenderable).toBeDefined();
        expect(Array.isArray(initialIndex)).toBe(true);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect((get().sessionListRowsByServerId['server-active'] ?? {})['s1']).toBe(initialRenderable);
        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
    });

    it('preserves ready metadata across applySessions refresh rows that omit it', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries({ trackWarmCacheEntries: true });

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 10,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                lastViewedSessionSeq: 8,
                latestTurnStatus: 'in_progress',
                latestReadyEventSeq: 9,
                latestReadyEventAt: 9_000,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 10,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                lastViewedSessionSeq: 8,
                latestTurnStatus: 'in_progress',
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessions.s1.latestReadyEventSeq).toBe(9);
        expect(get().sessions.s1.latestReadyEventAt).toBe(9_000);
        expect((get().sessionListRowsByServerId['server-active'] ?? {}).s1.latestReadyEventSeq).toBe(9);
        expect((get().sessionListRowsByServerId['server-active'] ?? {}).s1.latestReadyEventAt).toBe(9_000);
        expect(get().sessionListRowsByServerId['server-active'].s1.latestReadyEventSeq).toBe(9);
        expect(get().sessionListRowsByServerId['server-active'].s1.latestReadyEventAt).toBe(9_000);
    });

    it('keeps terminal unread renderables unread when only a partial transcript slice is cached', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries({ trackWarmCacheEntries: true });

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain, {
            sessionMessages: {
                s1: {
                    isLoaded: false,
                    messageIdsOldestFirst: ['old'],
                    messagesById: {
                        old: {
                            id: 'old',
                            kind: 'agent-text',
                            seq: 110,
                            localId: null,
                            createdAt: 1,
                            text: 'older visible message',
                        },
                    },
                },
            },
        });

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 742,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 1,
                lastViewedSessionSeq: 741,
                latestTurnStatus: 'completed',
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect((get().sessionListRowsByServerId['server-active'] ?? {}).s1.hasUnreadMessages).toBe(true);
        expect(get().sessionListRowsByServerId['server-active'].s1.hasUnreadMessages).toBe(true);
    });

    it('keeps the active-server sessionListIndex stable when ready metadata only changes row overlay state', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries({ trackWarmCacheEntries: true });

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 10,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                lastViewedSessionSeq: 4,
                latestTurnStatus: 'in_progress',
                latestReadyEventSeq: 4,
                latestReadyEventAt: 4_000,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);
        const initialIndex = get().sessionListIndexByServerId['server-active'];

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 11,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 1,
                lastViewedSessionSeq: 4,
                latestTurnStatus: 'in_progress',
                latestReadyEventSeq: 5,
                latestReadyEventAt: 5_000,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
        expect((get().sessionListRowsByServerId['server-active'] ?? {}).s1.latestReadyEventSeq).toBe(5);
        expect((get().sessionListRowsByServerId['server-active'] ?? {}).s1.latestReadyEventAt).toBe(5_000);
        expect((get().sessionListRowsByServerId['server-active'] ?? {}).s1.hasUnreadMessages).toBe(true);
        expect(get().sessionListRowsByServerId['server-active'].s1.latestReadyEventSeq).toBe(5);
        expect(get().sessionListRowsByServerId['server-active'].s1.latestReadyEventAt).toBe(5_000);
        expect(get().sessionListRowsByServerId['server-active'].s1.hasUnreadMessages).toBe(true);
    });

    it('reuses the previous session object for semantically identical applySessions refreshes', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                pendingCount: 0,
                pendingVersion: 1,
                metadata: {
                    machineId: 'm1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    summary: { text: 'hello', updatedAt: 1 },
                },
                metadataVersion: 1,
                agentState: {
                    requests: {},
                    completedRequests: {},
                    localControl: null,
                    capabilities: {},
                },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
                todos: [
                    {
                        id: 'todo-1',
                        content: 'Check session reuse',
                        status: 'pending',
                        priority: 'medium',
                    },
                ],
                ownerProfile: {
                    id: 'owner-1',
                    username: 'owner',
                    firstName: 'Own',
                    lastName: 'Er',
                    avatar: null,
                },
                accessLevel: 'admin',
                canApprovePermissions: true,
            } as any,
        ]);

        const initialSession = get().sessions['s1'];
        expect(initialSession).toBeDefined();

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                pendingCount: 0,
                pendingVersion: 1,
                metadata: {
                    machineId: 'm1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    summary: { text: 'hello', updatedAt: 1 },
                },
                metadataVersion: 1,
                agentState: {
                    requests: {},
                    completedRequests: {},
                    localControl: null,
                    capabilities: {},
                },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
                todos: [
                    {
                        id: 'todo-1',
                        content: 'Check session reuse',
                        status: 'pending',
                        priority: 'medium',
                    },
                ],
                ownerProfile: {
                    id: 'owner-1',
                    username: 'owner',
                    firstName: 'Own',
                    lastName: 'Er',
                    avatar: null,
                },
                accessLevel: 'admin',
                canApprovePermissions: true,
            } as any,
        ]);

        expect(get().sessions['s1']).toBe(initialSession);
    });

    it('keeps store collection references stable for active session heartbeat updates', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
            } as any,
        ]);

        const initialSession = get().sessions.s1;
        const initialSessions = get().sessions;
        const initialRenderables = (get().sessionListRowsByServerId['server-active'] ?? {});
        const initialIndex = get().sessionListIndexByServerId['server-active'];

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
            } as any,
        ]);

        expect(get().sessions.s1).toBe(initialSession);
        expect(get().sessions.s1?.activeAt).toBe(1);
        expect(get().sessions).toBe(initialSessions);
        expect((get().sessionListRowsByServerId['server-active'] ?? {})).toBe(initialRenderables);
        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
    });

    it('skips map churn and warm-cache writes for a semantically identical applySessions batch', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const warmCache = await import('../../domains/state/warmCachePersistence');
        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialSessions = get().sessions;
        const initialRenderables = (get().sessionListRowsByServerId['server-active'] ?? {});
        const initialIndex = get().sessionListIndexByServerId['server-active'];
        const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
        expect(Array.isArray(initialIndex)).toBe(true);
        expect(saveWarmCache).toHaveBeenCalledTimes(1);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessions).toBe(initialSessions);
        expect((get().sessionListRowsByServerId['server-active'] ?? {})).toBe(initialRenderables);
        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
        expect(saveWarmCache).toHaveBeenCalledTimes(1);
    });

    it('preserves previous warm-cache metadata when applySessions receives a stale replacement row', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const warmCache = await import('../../domains/state/warmCachePersistence');
        const { createSessionsDomain } = await import('./sessions');
        const { domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-1',
                seq: 1,
                createdAt: 1,
                updatedAt: 10,
                active: true,
                activeAt: 10,
                metadata: {
                    name: 'Cached title',
                    machineId: 'm1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                },
                metadataVersion: 1,
                pendingPermissionRequestCount: 1,
                pendingUserActionRequestCount: 0,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-1',
                seq: 1,
                createdAt: 1,
                updatedAt: 20,
                active: true,
                activeAt: 20,
                metadata: null,
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        await vi.advanceTimersByTimeAsync(1_000);

        const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
        const lastCall = saveWarmCache.mock.calls.at(-1);
        const entries = lastCall?.[2] as Record<string, any>;

        expect(entries?.s1).toEqual(expect.objectContaining({
            sessionId: 's1',
            updatedAt: 20,
            metadataVersion: 1,
            agentStateVersion: 0,
            name: 'Cached title',
            path: '/home/u/repo',
            homeDir: '/home/u',
            machineId: 'm1',
            hasPendingPermissionRequests: true,
            hasPendingUserActionRequests: false,
        }));
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('preserves transient renderable visibility flags across applySessions refreshes', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        get().sessionListRowsByServerId['server-active'] = {
            s1: {
                ...buildSessionListRenderableFromSession({
                    id: 's1',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    archivedAt: null,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 'online',
                } as any),
                keepVisibleWhenInactive: true,
            },
        };

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: false,
                activeAt: 2,
                archivedAt: null,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect((get().sessionListRowsByServerId['server-active'] ?? {})['s1']?.keepVisibleWhenInactive).toBe(true);
    });

    it('keeps the active-server sessionListIndex reference stable for non-structural renderable patches', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        replaceSessionListRows(domain, [
            buildSessionListRenderableFromSession({
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                pendingCount: 0,
                pendingVersion: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
            } as any),
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        patchActiveSessionListRows(domain, [
            {
                sessionId: 's1',
                patch: {
                    pendingCount: 4,
                    pendingVersion: 8,
                },
            },
        ]);

        expect((get().sessionListRowsByServerId['server-active'] ?? {})['s1']).toEqual(expect.objectContaining({
            pendingCount: 4,
            pendingVersion: 8,
        }));
        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
    });

    it('tracks canonical server-scoped session list index/rows for the active server', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({ serverId: 'server-1', serverUrl: 'https://example.com', generation: 1 }),
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-1',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessionListRowsByServerId).toBeDefined();
        expect(get().sessionListIndexByServerId).toBeDefined();
        expect(get().sessionListRowsByServerId['server-1']?.s1).toBeDefined();

        const initialIndex = get().sessionListIndexByServerId['server-1'];
        expect(Array.isArray(initialIndex)).toBe(true);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-1',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: { requests: {} },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-1']).toBe(initialIndex);
    });

    it('keeps owner-scoped sessions out of the active-server row/index state', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({ serverId: 'server-active', serverUrl: 'https://example.com', generation: 1 }),
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 'owner-session',
                serverId: 'server-owner',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessionListRowsByServerId['server-active']?.['owner-session']).toBeUndefined();
        expect(
            get().sessionListIndexByServerId['server-active']?.some(
                (item: SessionListIndexItem) => item.type === 'session' && item.sessionId === 'owner-session',
            ) ?? false,
        ).toBe(false);
        expect(get().sessionListRowsByServerId['server-owner']?.['owner-session']).toBeDefined();
        expect(
            get().sessionListIndexByServerId['server-owner']?.some(
                (item: SessionListIndexItem) => item.type === 'session' && item.sessionId === 'owner-session',
            ) ?? false,
        ).toBe(true);
    });

    it('repairs active-server indexes when only the session owner server changes', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({ serverId: 'server-active', serverUrl: 'https://example.com', generation: 1 }),
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        const baseSession = {
            id: 'owner-move-session',
            serverId: 'server-owner',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as any;

        domain.applySessions([baseSession]);

        const ownerRenderable = (get().sessionListRowsByServerId['server-active'] ?? {})['owner-move-session'];
        const initialActiveIndex = get().sessionListIndexByServerId['server-active'];
        expect(get().sessionListRowsByServerId['server-owner']?.['owner-move-session']).toBe(ownerRenderable);
        expect(
            initialActiveIndex?.some(
                (item: SessionListIndexItem) => item.type === 'session' && item.sessionId === 'owner-move-session',
            ) ?? false,
        ).toBe(false);

        domain.applySessions([
            {
                ...baseSession,
                serverId: 'server-active',
            },
        ]);

        expect((get().sessionListRowsByServerId['server-active'] ?? {})['owner-move-session']).toBe(ownerRenderable);
        expect(get().sessionListRowsByServerId['server-active']?.['owner-move-session']).toBe(ownerRenderable);
        expect(
            get().sessionListIndexByServerId['server-active']?.some(
                (item: SessionListIndexItem) => item.type === 'session' && item.sessionId === 'owner-move-session',
            ) ?? false,
        ).toBe(true);
        expect(get().sessionListRowsByServerId['server-owner']).toBeUndefined();
        expect(get().sessionListIndexByServerId['server-owner']).toBeUndefined();
    });

    it('keeps equivalent owner server ids in the active-server row/index state', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: 'http://localhost:53288',
                serverUrl: 'http://localhost:53288',
                generation: 1,
            }),
        }));
        vi.doMock('../../domains/server/serverProfiles', async () => {
            const actual = await vi.importActual<typeof import('../../domains/server/serverProfiles')>(
                '../../domains/server/serverProfiles',
            );
            return {
                ...actual,
                areServerProfileIdentifiersEquivalent: (left: string | null | undefined, right: string | null | undefined) => {
                    const ids = new Set([String(left ?? '').trim(), String(right ?? '').trim()]);
                    if (ids.has('srv_stack') && ids.has('http://localhost:53288')) {
                        return true;
                    }
                    return actual.areServerProfileIdentifiersEquivalent(left, right);
                },
            };
        });
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 'equivalent-owner-session',
                serverId: 'srv_stack',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const activeServerRows = get().sessionListRowsByServerId['http://localhost:53288'];
        const activeServerIndex = get().sessionListIndexByServerId['http://localhost:53288'];

        expect(activeServerRows?.['equivalent-owner-session']).toBeDefined();
        expect(
            activeServerIndex?.some(
                (item: SessionListIndexItem) => item.type === 'session' && item.sessionId === 'equivalent-owner-session',
            ) ?? false,
        ).toBe(true);
        expect(get().sessionListRowsByServerId['srv_stack']?.['equivalent-owner-session']).toBeUndefined();
    });

    it('removes stale exact-alias row/index projections after equivalent owner sessions converge to the active server', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: 'http://localhost:53288',
                serverUrl: 'http://localhost:53288',
                generation: 1,
            }),
        }));
        vi.doMock('../../domains/server/serverProfiles', async () => {
            const actual = await vi.importActual<typeof import('../../domains/server/serverProfiles')>(
                '../../domains/server/serverProfiles',
            );
            return {
                ...actual,
                areServerProfileIdentifiersEquivalent: (left: string | null | undefined, right: string | null | undefined) => {
                    const ids = new Set([String(left ?? '').trim(), String(right ?? '').trim()]);
                    if (ids.has('srv_stack') && ids.has('http://localhost:53288')) {
                        return true;
                    }
                    return actual.areServerProfileIdentifiersEquivalent(left, right);
                },
            };
        });
        mockSessionPersistenceBoundaries();

        const staleSession = {
            id: 'stale-alias-session',
            serverId: 'srv_stack',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: { machineId: 'm1', path: '/home/u/stale', homeDir: '/home/u' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as any;

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: {
                srv_stack: {
                    'stale-alias-session': buildSessionListRenderableFromSession(staleSession),
                },
            },
            sessionListIndexByServerId: {
                srv_stack: [{
                    type: 'session',
                    sessionId: 'stale-alias-session',
                    serverId: 'srv_stack',
                    groupKey: 'active',
                }],
            },
        });

        domain.applySessions([
            {
                id: 'equivalent-owner-session',
                serverId: 'srv_stack',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessionListRowsByServerId['http://localhost:53288']?.['equivalent-owner-session']).toBeDefined();
        expect(
            get().sessionListIndexByServerId['http://localhost:53288']?.some(
                (item: SessionListIndexItem) => item.type === 'session' && item.sessionId === 'equivalent-owner-session',
            ) ?? false,
        ).toBe(true);
        expect(get().sessionListRowsByServerId.srv_stack).toBeUndefined();
        expect(get().sessionListIndexByServerId.srv_stack).toBeUndefined();
    });

    it('keeps canonical server-scoped session list index/rows in sync when deleting a session', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        vi.doMock('../../domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({ serverId: 'server-1', serverUrl: 'https://example.com', generation: 1 }),
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-1',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-1'];
        expect(get().sessionListRowsByServerId['server-1']).toBe((get().sessionListRowsByServerId['server-active'] ?? {}));
        expect(Array.isArray(initialIndex)).toBe(true);
        expect((get().sessionListRowsByServerId['server-active'] ?? {})['s1']).toBeDefined();

        domain.deleteSession('s1');

        const nextIndex = get().sessionListIndexByServerId['server-1'];
        expect(get().sessionListRowsByServerId['server-1']).toBe((get().sessionListRowsByServerId['server-active'] ?? {}));
        expect(Array.isArray(nextIndex)).toBe(true);
        expect(nextIndex).not.toBe(initialIndex);
        expect(nextIndex?.some((item: any) => item.type === 'session' && item.sessionId === 's1')).toBe(false);
        expect((get().sessionListRowsByServerId['server-active'] ?? {})['s1']).toBeUndefined();
    });

    it('keeps the active-server sessionListIndex reference stable for non-structural renderable replacement', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        replaceSessionListRows(domain, [
            buildSessionListRenderableFromSession({
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                pendingCount: 0,
                pendingVersion: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
            } as any),
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        replaceSessionListRows(domain, [
            {
                ...(get().sessionListRowsByServerId['server-active'] ?? {})['s1'],
                updatedAt: 2,
                presence: 2,
                pendingCount: 4,
                pendingVersion: 8,
            },
        ]);

        expect((get().sessionListRowsByServerId['server-active'] ?? {})['s1']).toEqual(expect.objectContaining({
            updatedAt: 2,
            pendingCount: 4,
            pendingVersion: 8,
        }));
        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
    });

    it('repairs stale active-server row/index projections when an identical snapshot confirms warm-cache renderables', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const session = {
            id: 'warm-cache-session',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: true,
            activeAt: 2,
            archivedAt: null,
            pendingCount: 0,
            pendingVersion: 1,
            metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        } as Session;
        const warmCachedRenderable = buildSessionListRenderableFromSession(session);

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: {
                'server-active': { [warmCachedRenderable.id]: warmCachedRenderable },
            },
            ordinarySessionListMembershipByServerId: { 'server-active': [warmCachedRenderable.id] },
            sessionListIndexByServerId: {
                'server-active': [],
            },
        });

        domain.applySessions([session]);

        expect(get().sessionListRowsByServerId['server-active']?.[warmCachedRenderable.id]).toBe(warmCachedRenderable);
        expect(get().sessionListIndexByServerId['server-active']?.some(
            (item: SessionListIndexItem) => item.type === 'session' && item.sessionId === warmCachedRenderable.id,
        )).toBe(true);
    });

    it('keeps sessionListIndex stable when peer updates only change heartbeat and progress fields', async () => {
        const updateSessions = vi.fn();
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions },
        }));
        mockSessionPersistenceBoundaries();

        const { buildMachineDisplayRenderableFromMachine } = await import('../../domains/machines/machineDisplayRenderable');
        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        const machineA = {
            id: 'm-a',
            active: true,
            activeAt: 100,
            metadata: { host: 'host-a' },
        } as any;
        const machineB = {
            id: 'm-b',
            active: true,
            activeAt: 200,
            metadata: { host: 'host-b' },
        } as any;

        get().machines = {
            'm-a': machineA,
            'm-b': machineB,
        };
        get().machineDisplayById = {
            'm-a': buildMachineDisplayRenderableFromMachine(machineA),
            'm-b': buildMachineDisplayRenderableFromMachine(machineB),
        };

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 10,
                active: true,
                activeAt: 10,
                metadata: { machineId: 'm-stale', host: 'host-stale', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
            {
                id: 's2',
                seq: 2,
                createdAt: 2,
                updatedAt: 100,
                active: true,
                activeAt: 100,
                metadata: { machineId: 'm-a', host: 'host-a', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
            {
                id: 's3',
                seq: 3,
                createdAt: 3,
                updatedAt: 200,
                active: true,
                activeAt: 200,
                metadata: { machineId: 'm-b', host: 'host-b', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);
        expect(updateSessions).toHaveBeenCalledTimes(1);

        domain.applySessions([
            {
                id: 's2',
                seq: 4,
                createdAt: 2,
                updatedAt: 300,
                meaningfulActivityAt: 300,
                active: true,
                activeAt: 100,
                metadata: { machineId: 'm-a', host: 'host-a', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: { requests: {} },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
        expect(updateSessions).toHaveBeenCalledTimes(1);
    });

    it('skips reachable peer scans for row-only applySessions updates that cannot affect canonical targets', async () => {
        const updateSessions = vi.fn();
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions },
        }));
        mockSessionPersistenceBoundaries();

        const resolveSessionMachineRpcTargetSpy = vi.fn();
        vi.doMock('../../domains/session/resolveSessionReachableMachineId', async () => {
            const actual = await vi.importActual<typeof import('../../domains/session/resolveSessionReachableMachineId')>(
                '../../domains/session/resolveSessionReachableMachineId',
            );
            return {
                ...actual,
                resolveSessionMachineRpcTarget: (params: Parameters<typeof actual.resolveSessionMachineRpcTarget>[0]) => {
                    resolveSessionMachineRpcTargetSpy(params);
                    return actual.resolveSessionMachineRpcTarget(params);
                },
            };
        });

        const { buildMachineDisplayRenderableFromMachine } = await import('../../domains/machines/machineDisplayRenderable');
        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        const machineA = {
            id: 'm-a',
            active: true,
            activeAt: 100,
            metadata: { host: 'host-a' },
        } as any;
        const machineB = {
            id: 'm-b',
            active: true,
            activeAt: 200,
            metadata: { host: 'host-b' },
        } as any;

        get().machines = {
            'm-a': machineA,
            'm-b': machineB,
        };
        get().machineDisplayById = {
            'm-a': buildMachineDisplayRenderableFromMachine(machineA),
            'm-b': buildMachineDisplayRenderableFromMachine(machineB),
        };

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 10,
                active: true,
                activeAt: 10,
                metadata: { machineId: 'm-stale', host: 'host-stale', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
            {
                id: 's2',
                seq: 2,
                createdAt: 2,
                updatedAt: 100,
                active: true,
                activeAt: 100,
                metadata: { machineId: 'm-a', host: 'host-a', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
            {
                id: 's3',
                seq: 3,
                createdAt: 3,
                updatedAt: 200,
                active: true,
                activeAt: 200,
                metadata: { machineId: 'm-b', host: 'host-b', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);
        const initialResolveCallCount = resolveSessionMachineRpcTargetSpy.mock.calls.length;

        domain.applySessions([
            {
                id: 's2',
                seq: 2,
                createdAt: 2,
                updatedAt: 100,
                active: true,
                activeAt: 100,
                metadata: { machineId: 'm-a', host: 'host-a', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: { requests: {} },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
        expect(resolveSessionMachineRpcTargetSpy).toHaveBeenCalledTimes(initialResolveCallCount);
    });

    it('skips reachable peer scans for active metadata-version-only updates with explicit canonical targets', async () => {
        const updateSessions = vi.fn();
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions },
        }));
        mockSessionPersistenceBoundaries();

        const resolveSessionMachineRpcTargetSpy = vi.fn();
        vi.doMock('../../domains/session/resolveSessionReachableMachineId', async () => {
            const actual = await vi.importActual<typeof import('../../domains/session/resolveSessionReachableMachineId')>(
                '../../domains/session/resolveSessionReachableMachineId',
            );
            return {
                ...actual,
                resolveSessionMachineRpcTarget: (params: Parameters<typeof actual.resolveSessionMachineRpcTarget>[0]) => {
                    resolveSessionMachineRpcTargetSpy(params);
                    return actual.resolveSessionMachineRpcTarget(params);
                },
            };
        });

        const { buildMachineDisplayRenderableFromMachine } = await import('../../domains/machines/machineDisplayRenderable');
        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        const machine = {
            id: 'm-a',
            active: true,
            activeAt: 100,
            metadata: { host: 'host-a' },
        } as any;
        get().machines = { 'm-a': machine };
        get().machineDisplayById = { 'm-a': buildMachineDisplayRenderableFromMachine(machine) };

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 100,
                active: true,
                activeAt: 100,
                metadata: {
                    machineId: 'm-a',
                    host: 'host-a',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    name: 'Initial title',
                },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);
        const initialResolveCallCount = resolveSessionMachineRpcTargetSpy.mock.calls.length;

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 101,
                active: true,
                activeAt: 100,
                metadata: {
                    machineId: 'm-a',
                    host: 'host-a',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    name: 'Updated title',
                    summaryText: 'Updated non-reachability summary',
                },
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
        expect(resolveSessionMachineRpcTargetSpy).toHaveBeenCalledTimes(initialResolveCallCount);
        expect(updateSessions).toHaveBeenCalledTimes(1);
    });

    it('rebuilds sessionListIndex when a peer project lookup changes and can retarget a stale session', async () => {
        const updateSessions = vi.fn();
        const resolveSessionMachineRpcTargetSpy = vi.fn();
        let peerProjectMachineId = 'm-b';
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: {
                updateSessions,
            },
        }));
        vi.doMock('../../domains/session/resolveSessionReachableMachineId', async () => {
            const actual = await vi.importActual<typeof import('../../domains/session/resolveSessionReachableMachineId')>(
                '../../domains/session/resolveSessionReachableMachineId',
            );
            return {
                ...actual,
                resolveSessionMachineRpcTarget: (params: Parameters<typeof actual.resolveSessionMachineRpcTarget>[0]) => {
                    resolveSessionMachineRpcTargetSpy(params);
                    return actual.resolveSessionMachineRpcTarget(params);
                },
            };
        });
        mockSessionPersistenceBoundaries();

        const { buildMachineDisplayRenderableFromMachine } = await import('../../domains/machines/machineDisplayRenderable');
        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        const machineA = {
            id: 'm-a',
            active: true,
            activeAt: 100,
            metadata: { host: 'host-a' },
        } as any;
        const machineB = {
            id: 'm-b',
            active: true,
            activeAt: 200,
            metadata: { host: 'host-b' },
        } as any;

        get().machines = {
            'm-a': machineA,
            'm-b': machineB,
        };
        get().machineDisplayById = {
            'm-a': buildMachineDisplayRenderableFromMachine(machineA),
            'm-b': buildMachineDisplayRenderableFromMachine(machineB),
        };
        get().getProjectForSession = (sessionId: string) => {
            if (sessionId === 's2') {
                return {
                    id: 'project-s2',
                    key: {
                        serverId: 'server-1',
                        machineId: peerProjectMachineId,
                        rootPath: '/home/u/repo',
                    },
                    sessionIds: ['s2'],
                    createdAt: 1,
                    updatedAt: 1,
                };
            }
            return null;
        };

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 10,
                active: true,
                activeAt: 10,
                metadata: { path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
            {
                id: 's2',
                seq: 2,
                createdAt: 2,
                updatedAt: 100,
                active: true,
                activeAt: 100,
                metadata: { path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);
        const initialResolveCallCount = resolveSessionMachineRpcTargetSpy.mock.calls.length;

        peerProjectMachineId = 'm-a';
        domain.applySessions([
            {
                id: 's2',
                seq: 2,
                createdAt: 2,
                updatedAt: 101,
                active: true,
                activeAt: 100,
                metadata: { path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).not.toBe(initialIndex);
        expect(resolveSessionMachineRpcTargetSpy.mock.calls.length).toBeGreaterThan(initialResolveCallCount);
        expect(updateSessions).toHaveBeenCalled();
    });

    it('rebuilds the active-server sessionListIndex for structural applySessions changes (grouping keys)', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/other', homeDir: '/home/u' },
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).not.toBe(initialIndex);
    });

    it('rebuilds the active-server sessionListIndex when archivedAt changes (visibility)', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                archivedAt: 123,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).not.toBe(initialIndex);
    });

    it('rebuilds the active-server sessionListIndex when direct-session storage classification changes', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                archivedAt: null,
                metadata: {
                    machineId: 'm1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    externalSessionV1: {
                        v: 1,
                        agentId: 'codex',
                    },
                },
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).not.toBe(initialIndex);
    });

    it('preserves linked direct-session metadata when a later refresh omits externalSessionV1', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                metadata: {
                    machineId: 'm1',
                    host: 'h1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    externalSessionV1: {
                        v: 1,
                        agentId: 'claude',
                        machineId: 'm1',
                        remoteSessionId: 'remote-1',
                        source: { kind: 'claudeConfigDir', configDir: '/tmp/claude' },
                    },
                },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(getSessionStorageKind(get().sessions.s1)).toBe('direct');
        expect(
            get().sessionListIndexByServerId['server-active']?.some(
                (item: any) => item.type === 'session' && item.sessionId === 's1' && (item.storageKind ?? 'persisted') === 'direct',
            ),
        ).toBe(true);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                archivedAt: null,
                metadata: {
                    machineId: 'm1',
                    host: 'h1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                },
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect((get().sessions.s1?.metadata as any)?.externalSessionV1).toEqual(expect.objectContaining({
            v: 1,
            agentId: 'claude',
            remoteSessionId: 'remote-1',
        }));
        expect(getSessionStorageKind(get().sessions.s1)).toBe('direct');
        expect(
            get().sessionListIndexByServerId['server-active']?.some(
                (item: any) => item.type === 'session' && item.sessionId === 's1' && (item.storageKind ?? 'persisted') === 'direct',
            ),
        ).toBe(true);
    });

    it('preserves linked direct-session metadata when a later refresh sets externalSessionV1 to null', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                archivedAt: null,
                metadata: {
                    machineId: 'm1',
                    host: 'h1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    externalSessionV1: {
                        v: 1,
                        agentId: 'claude',
                        machineId: 'm1',
                        remoteSessionId: 'remote-1',
                        source: { kind: 'claudeConfigDir', configDir: '/tmp/claude' },
                    },
                },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                archivedAt: null,
                metadata: {
                    machineId: 'm1',
                    host: 'h1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    externalSessionV1: null,
                },
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect((get().sessions.s1?.metadata as any)?.externalSessionV1).toEqual(expect.objectContaining({
            v: 1,
            agentId: 'claude',
            remoteSessionId: 'remote-1',
        }));
        expect(getSessionStorageKind(get().sessions.s1)).toBe('direct');
        expect(
            get().sessionListIndexByServerId['server-active']?.some(
                (item: any) => item.type === 'session' && item.sessionId === 's1' && (item.storageKind ?? 'persisted') === 'direct',
            ),
        ).toBe(true);
    });

    it('does not rebuild the active-server sessionListIndex when updating a draft for a loaded session', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
    });

    it('does not resurrect a cleared draft when applySessions merges a loaded session update', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const warmCache = await import('../../domains/state/warmCachePersistence');
        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);
        const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
        expect(saveWarmCache).toHaveBeenCalledTimes(1);

        domain.applySessions([
            {
                id: 's1',
                seq: 2,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
                draft: 'server stale draft',
            } as any,
        ]);

        expect(get().sessions.s1?.draft).toBe('server stale draft');
        await vi.advanceTimersByTimeAsync(1_000);
        expect(saveWarmCache).toHaveBeenCalledTimes(2);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('reuses the previous warm-cache renderable map when applySessions updates only one warm-cache relevant row', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries({ trackWarmCacheEntries: true });
        vi.doMock('../../domains/state/warmCacheAdapters', async () => {
            const actual = await vi.importActual<typeof import('../../domains/state/warmCacheAdapters')>('../../domains/state/warmCacheAdapters');
            return {
                ...actual,
                buildPersistedSessionListCacheEntriesFromRenderables: vi.fn(actual.buildPersistedSessionListCacheEntriesFromRenderables),
            };
        });

        const warmCache = await import('../../domains/state/warmCachePersistence');
        const warmCacheAdapters = await import('../../domains/state/warmCacheAdapters');
        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
            {
                id: 's2',
                serverId: 'server-active',
                seq: 2,
                createdAt: 2,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm2', path: '/home/u/repo-2', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
        const buildPreviousEntries = warmCacheAdapters.buildPersistedSessionListCacheEntriesFromRenderables as unknown as ReturnType<typeof vi.fn>;
        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);
        expect(saveWarmCache).toHaveBeenCalledTimes(1);

        const firstEntries = saveWarmCache.mock.calls[0]?.[2] as Record<string, unknown>;
        expect(firstEntries).toBeDefined();

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
                pendingCount: 1,
                pendingVersion: 2,
            } as any,
        ]);

        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(saveWarmCache).toHaveBeenCalledTimes(2);
        expect(buildPreviousEntries.mock.calls[1]?.[1]).toBe(firstEntries);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('does not rebuild the active-server sessionListIndex when marking optimistic thinking', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { createSessionsDomain } = await import('./sessions');
        const { get, domain } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        const initialIndex = get().sessionListIndexByServerId['server-active'];
        expect(Array.isArray(initialIndex)).toBe(true);

        domain.markSessionOptimisticThinking('s1');
        expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
    });

    it('does not rewrite the warm cache for thinking-only applySessions updates', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
                normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
                projectManager: { updateSessions: vi.fn() },
            }));
            mockSessionPersistenceBoundaries();

            const warmCache = await import('../../domains/state/warmCachePersistence');
            const { createSessionsDomain } = await import('./sessions');
            const { get, domain } = createHarness(createSessionsDomain);

            domain.applySessions([
                {
                    id: 's1',
                    serverId: 'server-active',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 1,
                } as any,
            ]);

            const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
            expect(saveWarmCache).toHaveBeenCalledTimes(1);
            const initialIndex = get().sessionListIndexByServerId['server-active'];

            domain.applySessions([
                {
                    id: 's1',
                    serverId: 'server-active',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: true,
                    thinkingAt: 1,
                    presence: 1,
                } as any,
            ]);

            expect(get().sessions.s1?.thinking).toBe(true);
            expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
            expect(saveWarmCache).toHaveBeenCalledTimes(1);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('coalesces warm cache persistence for repeated applySessions cache-entry updates', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
                normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
                projectManager: { updateSessions: vi.fn() },
            }));
            mockSessionPersistenceBoundaries();

            const warmCache = await import('../../domains/state/warmCachePersistence');
            const { createSessionsDomain } = await import('./sessions');
            const { get, domain } = createHarness(createSessionsDomain);

            const buildSession = (version: number, title: string) => ({
                id: 's1',
                serverId: 'server-active',
                seq: version,
                createdAt: 1,
                updatedAt: version,
                active: true,
                activeAt: 1,
                metadata: {
                    machineId: 'm1',
                    path: '/home/u/repo',
                    homeDir: '/home/u',
                    name: title,
                },
                metadataVersion: version,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
            } as any);

            domain.applySessions([buildSession(1, 'Initial title')]);

            const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
            expect(saveWarmCache).toHaveBeenCalledTimes(1);
            saveWarmCache.mockClear();

            domain.applySessions([buildSession(2, 'Updated title')]);
            domain.applySessions([buildSession(3, 'Final title')]);

            expect(get().sessions.s1?.metadata?.name).toBe('Final title');
            expect(saveWarmCache).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1_000);

            expect(saveWarmCache).toHaveBeenCalledTimes(1);
            const entries = saveWarmCache.mock.calls.at(-1)?.[2] as Record<string, any>;
            expect(entries?.s1?.name).toBe('Final title');
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('coalesces warm cache writes for active streaming progress when list rows are stable', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
                normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
                projectManager: { updateSessions: vi.fn() },
            }));
            mockSessionPersistenceBoundaries();

            const warmCache = await import('../../domains/state/warmCachePersistence');
            const { createSessionsDomain } = await import('./sessions');
            const { get, domain } = createHarness(createSessionsDomain);

            domain.applySessions([
                {
                    id: 'streaming',
                    serverId: 'server-active',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: true,
                    thinkingAt: 1,
                    presence: 'online',
                } as any,
            ]);

            const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
            expect(saveWarmCache).toHaveBeenCalledTimes(1);
            const initialIndex = get().sessionListIndexByServerId['server-active'];
            expect(Array.isArray(initialIndex)).toBe(true);

            for (let index = 0; index < 10; index += 1) {
                domain.applySessions([
                    {
                        id: 'streaming',
                        serverId: 'server-active',
                        seq: index + 2,
                        createdAt: 1,
                        updatedAt: index + 2,
                        active: true,
                        activeAt: index + 2,
                        metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                        metadataVersion: 1,
                        agentState: null,
                        agentStateVersion: 0,
                        thinking: true,
                        thinkingAt: 1,
                        presence: 'online',
                    } as any,
                ]);
            }

            expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
            expect(saveWarmCache).toHaveBeenCalledTimes(1);
            vi.runOnlyPendingTimers();
            expect(saveWarmCache).toHaveBeenCalledTimes(2);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('cancels deferred warm cache writes when the session local state scope switches', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
                normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
                projectManager: { updateSessions: vi.fn() },
            }));
            mockSessionPersistenceBoundaries();

            const warmCache = await import('../../domains/state/warmCachePersistence');
            const { createSessionsDomain } = await import('./sessions');
            const { domain } = createHarness(createSessionsDomain);

            domain.applySessions([
                {
                    id: 'streaming',
                    serverId: 'server-active',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: true,
                    thinkingAt: 1,
                    presence: 'online',
                } as any,
            ]);

            const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
            expect(saveWarmCache).toHaveBeenCalledTimes(1);

            domain.applySessions([
                {
                    id: 'streaming',
                    serverId: 'server-active',
                    seq: 2,
                    createdAt: 1,
                    updatedAt: 2,
                    active: true,
                    activeAt: 2,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: true,
                    thinkingAt: 1,
                    presence: 'online',
                } as any,
            ]);

            expect(saveWarmCache).toHaveBeenCalledTimes(1);

            domain.activateSessionLocalStateScope({ serverId: 'server-active', accountId: 'account-b' });
            vi.runOnlyPendingTimers();

            expect(saveWarmCache).toHaveBeenCalledTimes(1);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('cancels deferred warm cache writes when the session local state scope clears', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
                normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
                projectManager: { updateSessions: vi.fn() },
            }));
            mockSessionPersistenceBoundaries();

            const warmCache = await import('../../domains/state/warmCachePersistence');
            const { createSessionsDomain } = await import('./sessions');
            const { domain } = createHarness(createSessionsDomain);

            domain.applySessions([
                {
                    id: 'streaming',
                    serverId: 'server-active',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: true,
                    thinkingAt: 1,
                    presence: 'online',
                } as any,
            ]);

            const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
            expect(saveWarmCache).toHaveBeenCalledTimes(1);

            domain.applySessions([
                {
                    id: 'streaming',
                    serverId: 'server-active',
                    seq: 2,
                    createdAt: 1,
                    updatedAt: 2,
                    active: true,
                    activeAt: 2,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: true,
                    thinkingAt: 1,
                    presence: 'online',
                } as any,
            ]);

            expect(saveWarmCache).toHaveBeenCalledTimes(1);

            domain.clearSessionLocalStateScope();
            vi.runOnlyPendingTimers();

            expect(saveWarmCache).toHaveBeenCalledTimes(1);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('coalesces warm cache writes for active streaming progress during renderable replacement', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        try {
            vi.doMock('../../runtime/orchestration/projectManager', () => ({
                normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
                projectManager: { updateSessions: vi.fn() },
            }));
            mockSessionPersistenceBoundaries();

            const warmCache = await import('../../domains/state/warmCachePersistence');
            const { createSessionsDomain } = await import('./sessions');
            const { get, domain } = createHarness(createSessionsDomain);

            const buildStreamingSession = (seq: number) => ({
                id: 'streaming',
                serverId: 'server-active',
                seq,
                createdAt: 1,
                updatedAt: seq,
                active: true,
                activeAt: seq,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: true,
                thinkingAt: 1,
                presence: 'online',
            } as any);

            domain.applySessions([buildStreamingSession(1)]);

            const saveWarmCache = warmCache.saveSessionListWarmCacheEntries as unknown as ReturnType<typeof vi.fn>;
            expect(saveWarmCache).toHaveBeenCalledTimes(1);
            const initialIndex = get().sessionListIndexByServerId['server-active'];
            expect(Array.isArray(initialIndex)).toBe(true);

            for (let seq = 2; seq <= 11; seq += 1) {
                replaceSessionListRows(domain, [
                    buildSessionListRenderableFromSession(buildStreamingSession(seq)),
                ]);
            }

            expect(get().sessionListIndexByServerId['server-active']).toBe(initialIndex);
            expect(saveWarmCache).toHaveBeenCalledTimes(1);
            vi.runOnlyPendingTimers();
            expect(saveWarmCache).toHaveBeenCalledTimes(2);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('records applySessions telemetry when sync performance telemetry is enabled', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();

        const { syncPerformanceTelemetry } = await import('@/sync/runtime/syncPerformanceTelemetry');
        const { createSessionsDomain } = await import('./sessions');
        const { domain } = createHarness(createSessionsDomain);

        syncPerformanceTelemetry.configure({
            enabled: true,
            slowThresholdMs: 1_000_000,
            flushIntervalMs: 60_000,
        });
        syncPerformanceTelemetry.reset();

        try {
            domain.applySessions([
                {
                    id: 's1',
                    serverId: 'server-active',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 1,
                } as any,
            ]);

            const event = syncPerformanceTelemetry
                .snapshot()
                .events.find((candidate) => candidate.name === 'sync.store.sessions.apply');
            expect(event?.count).toBe(1);
            expect(event?.fields.sessions).toBe(1);

            const changedEvent = syncPerformanceTelemetry
                .snapshot()
                .events.find((candidate) => candidate.name === 'sync.store.sessions.apply.changed');
            expect(changedEvent?.count).toBe(1);
            expect(changedEvent?.fields.changedSessions).toBe(1);
            expect(changedEvent?.fields.changedRenderables).toBe(1);
            expect(changedEvent?.fields.indexRebuild).toBe(1);
            expect(changedEvent?.fields.projectManagerUpdate).toBe(1);

            const firstApplyEvents = syncPerformanceTelemetry.snapshot().events;
            const mergeEvent = firstApplyEvents.find((candidate) => candidate.name === 'sync.store.sessions.apply.merge');
            expect(mergeEvent?.count).toBe(1);
            expect(mergeEvent?.fields.sessions).toBe(1);
            const mergeOutcomeEvent = firstApplyEvents.find((candidate) => candidate.name === 'sync.store.sessions.apply.merge.outcome');
            expect(mergeOutcomeEvent?.count).toBe(1);
            expect(mergeOutcomeEvent?.fields.changedSessions).toBe(1);
            expect(mergeOutcomeEvent?.fields.changedRenderables).toBe(1);
            expect(mergeOutcomeEvent?.fields.indexRebuild).toBe(1);
            expect(mergeOutcomeEvent?.fields.listViewFieldChanges).toBe(1);
            const indexRebuildEvent = firstApplyEvents.find((candidate) => candidate.name === 'sync.store.sessions.apply.indexRebuild');
            expect(indexRebuildEvent?.count).toBe(1);
            expect(indexRebuildEvent?.fields.renderables).toBe(1);
            const projectManagerEvent = firstApplyEvents.find((candidate) => candidate.name === 'sync.store.sessions.apply.projectManager');
            expect(projectManagerEvent?.count).toBe(1);
            expect(projectManagerEvent?.fields.sessions).toBe(1);
            const warmCacheEvent = firstApplyEvents.find((candidate) => candidate.name === 'sync.store.sessions.apply.warmCache');
            expect(warmCacheEvent?.count).toBe(1);
            expect(warmCacheEvent?.fields.renderables).toBe(1);

            domain.applySessions([
                {
                    id: 's1',
                    serverId: 'server-active',
                    seq: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    active: true,
                    activeAt: 1,
                    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 1,
                } as any,
            ]);

            const noopEvent = syncPerformanceTelemetry
                .snapshot()
                .events.find((candidate) => candidate.name === 'sync.store.sessions.apply.noop');
            expect(noopEvent?.count).toBe(1);
            expect(noopEvent?.fields.sessions).toBe(1);
        } finally {
            syncPerformanceTelemetry.configure({ enabled: false });
        }
    });

    it('publishes changed renderable ids from applySessions', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();
        const { createSessionsDomain } = await import('./sessions');
        const { domain, get } = createHarness(createSessionsDomain);

        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: 1,
            } as any,
        ]);

        expect(get().sessionListRenderableDelta).toEqual({
            revision: 1,
            changedSessionIds: ['s1'],
            removedSessionIds: [],
            rebuiltSessionListIndex: true,
        });

        const firstDelta = get().sessionListRenderableDelta;
        domain.applySessions([
            {
                id: 's1',
                serverId: 'server-active',
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                active: true,
                activeAt: 2,
                metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
                metadataVersion: 1,
                agentState: { requests: {} },
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 2,
            } as any,
        ]);

        expect(get().sessionListRenderableDelta).toEqual({
            revision: 2,
            changedSessionIds: ['s1'],
            removedSessionIds: [],
            rebuiltSessionListIndex: false,
        });
        expect(get().sessionListRenderableDelta).not.toBe(firstDelta);
    });
});

describe('sessions domain: qualified rows and ordinary membership', () => {
    it('does not promote an exact or query-only hydrated row into ordinary membership', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();
        const { createSessionsDomain } = await import('./sessions');
        const queryOnlySession: Session = {
            id: 'query-only',
            serverId: 'server-active',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            archivedAt: null,
            metadata: { machineId: 'm1', path: '/query', host: 'host' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        };
        const queryOnly = buildSessionListRenderableFromSession(queryOnlySession);
        const { domain, get } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: { 'server-active': { 'query-only': queryOnly } },
            ordinarySessionListMembershipByServerId: { 'server-active': [] },
            archivedSessionListMembershipByServerId: {},
            sessionListIndexByServerId: { 'server-active': [] },
        });

        domain.applySessions([{
            ...queryOnlySession,
            seq: 2,
            updatedAt: 2,
            metadata: { ...queryOnlySession.metadata, name: 'Hydrated exact result' },
        }]);

        expect(get().sessions['query-only']).toEqual(expect.objectContaining({
            id: 'query-only',
            updatedAt: 2,
        }));
        expect(get().sessionListRowsByServerId['server-active']['query-only']).toEqual(expect.objectContaining({
            id: 'query-only',
            updatedAt: 2,
        }));
        expect(get().ordinarySessionListMembershipByServerId['server-active']).toEqual([]);
        expect(readSessionListIndexSessionIds(get().sessionListIndexByServerId['server-active'])).toEqual([]);
    });

    it('keeps query-only rows out of the ordinary list corpus', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();
        const { createSessionsDomain } = await import('./sessions');
        const { domain, get } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: {},
        });
        const queryOnly = buildSessionListRenderableFromSession({
            id: 'query-only',
            serverId: 'server-a',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            archivedAt: null,
            metadata: { machineId: 'm1', path: '/query', host: 'host' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as Session);
        const ordinary = buildSessionListRenderableFromSession({
            ...queryOnly,
            id: 'ordinary',
            metadata: { machineId: 'm1', path: '/ordinary', host: 'host' },
        } as Session);

        domain.applyServerScopedSessionListRows('server-a', [queryOnly], {
            source: 'rowOnly',
            mode: 'replace',
        });

        expect(get().sessionListRowsByServerId['server-a']).toEqual({
            'query-only': queryOnly,
        });
        expect(get().ordinarySessionListMembershipByServerId['server-a']).toBeUndefined();
        expect(get().archivedSessionListMembershipByServerId['server-a']).toBeUndefined();
        expect(get().sessionListIndexByServerId['server-a']).toBeUndefined();

        domain.applyServerScopedSessionListRows('server-a', [ordinary], {
            source: 'ordinary',
            mode: 'replace',
        });

        expect(get().sessionListRowsByServerId['server-a']).toEqual({
            'query-only': queryOnly,
            ordinary,
        });
        expect(get().ordinarySessionListMembershipByServerId['server-a']).toEqual(['ordinary']);
        expect(readSessionListIndexSessionIds(get().sessionListIndexByServerId['server-a'])).toEqual(['ordinary']);
    });

    it('never lets an ad-hoc row-only read publish the ordinary list index', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();
        const { createSessionsDomain } = await import('./sessions');
        // Ordinary membership already exists, but its index has not been built yet — the state a
        // Home reaches after rehydration before its list owner runs.
        const { domain, get } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: { 'server-a': ['ordinary'] },
            sessionListIndexByServerId: {},
        });
        const adHoc = buildSessionListRenderableFromSession({
            id: 'ad-hoc',
            serverId: 'server-a',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            archivedAt: null,
            metadata: { machineId: 'm1', path: '/ad-hoc', host: 'host' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as Session);

        domain.applyServerScopedSessionListRows('server-a', [adHoc], {
            source: 'rowOnly',
            mode: 'replace',
        });

        // The row is hydrated for the command that asked for it, and nothing else moves: a Voice
        // or Action read owns no corpus, so it cannot publish a visible list either (L07-I35).
        expect(get().sessionListRowsByServerId['server-a']).toEqual({ 'ad-hoc': adHoc });
        expect(get().ordinarySessionListMembershipByServerId['server-a']).toEqual(['ordinary']);
        expect(get().sessionListIndexByServerId['server-a']).toBeUndefined();
    });

    it('rebuilds the ordinary projection when a scoped hydration patch changes a member row', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();
        const { createSessionsDomain } = await import('./sessions');
        const { domain, get } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: {},
        });
        const ordinary = buildSessionListRenderableFromSession({
            id: 'ordinary',
            serverId: 'server-a',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            archivedAt: null,
            metadata: { machineId: 'm1', path: '/ordinary', host: 'host' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as Session);
        domain.applyServerScopedSessionListRows('server-a', [ordinary], {
            source: 'ordinary',
            mode: 'replace',
        });
        expect(get().sessionListIndexByServerId['server-a'].find(
            (item: SessionListIndexItem) => item.type === 'session',
        )?.section).toBe('active');

        domain.applyServerScopedSessionListRowPatches('server-a', [{
            sessionId: 'ordinary',
            patch: { active: false, activeAt: 2, presence: 2 },
        }]);

        expect(get().sessionListRowsByServerId['server-a'].ordinary.active).toBe(false);
        expect(get().sessionListIndexByServerId['server-a'].find(
            (item: SessionListIndexItem) => item.type === 'session',
        )?.section).toBe('inactive');
    });

    it('owns archived membership separately from ordinary membership and preserves shared rows', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();
        const { createSessionsDomain } = await import('./sessions');
        const { domain, get } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: {},
            archivedSessionListMembershipByServerId: {},
        });
        const archivedA = buildSessionListRenderableFromSession({
            id: 'archived-a',
            serverId: 'server-a',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: false,
            activeAt: 1,
            archivedAt: 2,
            metadata: { machineId: 'm1', path: '/archived-a', host: 'host' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as Session);
        const archivedB = buildSessionListRenderableFromSession({
            ...archivedA,
            id: 'archived-b',
            updatedAt: 3,
            archivedAt: 3,
            metadata: { machineId: 'm1', path: '/archived-b', host: 'host' },
        } as Session);

        expect(get().archivedSessionListMembershipByServerId['server-a']).toBeUndefined();
        domain.applyServerScopedSessionListRows('server-a', [archivedA], {
            source: 'archived',
            mode: 'replace',
        });
        domain.applyServerScopedSessionListRows('server-a', [archivedA, archivedB], {
            source: 'archived',
            mode: 'append',
        });

        expect(get().archivedSessionListMembershipByServerId['server-a']).toEqual([
            'archived-a',
            'archived-b',
        ]);
        expect(get().ordinarySessionListMembershipByServerId['server-a']).toBeUndefined();
        const retainedRows = get().sessionListRowsByServerId['server-a'];

        domain.applyServerScopedSessionListRows('server-a', [], {
            source: 'archived',
            mode: 'replace',
        });
        expect(get().archivedSessionListMembershipByServerId['server-a']).toEqual([]);
        expect(get().sessionListRowsByServerId['server-a']).toBe(retainedRows);

        domain.applyServerScopedSessionListRows('server-a', [archivedA, archivedB], {
            source: 'archived',
            mode: 'replace',
        });
        domain.applyServerScopedSessionListRows('server-a', [{
            ...archivedA,
            updatedAt: 4,
            archivedAt: null,
        }], {
            source: 'ordinary',
            mode: 'append',
        });

        expect(get().archivedSessionListMembershipByServerId['server-a']).toEqual(['archived-b']);
        expect(get().ordinarySessionListMembershipByServerId['server-a']).toEqual(['archived-a']);
        expect(get().sessionListRowsByServerId['server-a']['archived-a']?.archivedAt).toBeNull();
    });
});

/**
 * Lane 07 R18 / 07.5 §12 Packet D measurement at the canonical row-ingestion
 * and index owners: three Homes of fifty loaded rows. It records ingestion,
 * rebuild and rapid-change cost and proves that one Home's change leaves the
 * other Homes' index references untouched. Timings are recorded, never
 * asserted, and no cache or memoization is introduced here.
 */
describe('sessions domain: three-Home ingestion and index rebuild cost', () => {
    const HOME_COUNT = 3;
    const ROWS_PER_HOME = 50;
    const homeServerIds = Array.from({ length: HOME_COUNT }, (_, home) => `ingestion-home-${home}`);

    function buildHomeRows(home: number): SessionListRenderableSession[] {
        return Array.from({ length: ROWS_PER_HOME }, (_, index) => buildSessionListRenderableFromSession({
            id: `ingestion-session-${home}-${index}`,
            serverId: homeServerIds[home],
            seq: index,
            createdAt: 1_000 + index,
            updatedAt: 1_000 + index,
            active: true,
            activeAt: 1_000 + index,
            archivedAt: null,
            metadata: { machineId: `m-${home}`, path: `/repo-${home}/project-${index % 5}`, host: 'host' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        } as Session));
    }

    it('keeps unrelated Home indexes referentially stable across ingestion, patches and rapid changes', async () => {
        vi.doMock('../../runtime/orchestration/projectManager', () => ({
            normalizeKnownProjectMachineId: normalizeKnownProjectMachineIdMock,
            projectManager: { updateSessions: vi.fn() },
        }));
        mockSessionPersistenceBoundaries();
        const { createSessionsDomain } = await import('./sessions');
        const { domain, get, getSetCalls } = createHarness(createSessionsDomain, {
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: {},
            sessionListIndexByServerId: {},
        });

        const ingestStartedAt = performance.now();
        const setCallsBeforeIngest = getSetCalls();
        for (let home = 0; home < HOME_COUNT; home += 1) {
            domain.applyServerScopedSessionListRows(homeServerIds[home], buildHomeRows(home), {
                source: 'ordinary',
                mode: 'replace',
            });
        }
        const ingestMs = performance.now() - ingestStartedAt;
        const ingestSetCalls = getSetCalls() - setCallsBeforeIngest;

        for (const serverId of homeServerIds) {
            expect(get().ordinarySessionListMembershipByServerId[serverId]).toHaveLength(ROWS_PER_HOME);
            expect(readSessionListIndexSessionIds(get().sessionListIndexByServerId[serverId]))
                .toHaveLength(ROWS_PER_HOME);
        }

        const indexesAfterIngest = Object.fromEntries(
            homeServerIds.map((serverId) => [serverId, get().sessionListIndexByServerId[serverId]]),
        );

        const patchedServerId = homeServerIds[1];
        const patchedSessionId = `ingestion-session-1-17`;

        const nonStructuralStartedAt = performance.now();
        patchActiveSessionListRows(domain, []);
        domain.applyServerScopedSessionListRowPatches(patchedServerId, [{
            sessionId: patchedSessionId,
            patch: { latestTurnStatus: 'completed', latestTurnStatusObservedAt: 4_000 },
        }]);
        const nonStructuralPatchMs = performance.now() - nonStructuralStartedAt;

        for (const serverId of homeServerIds) {
            expect(get().sessionListIndexByServerId[serverId]).toBe(indexesAfterIngest[serverId]);
        }
        expect(get().sessionListRowsByServerId[patchedServerId][patchedSessionId]?.latestTurnStatus)
            .toBe('completed');

        const structuralStartedAt = performance.now();
        domain.applyServerScopedSessionListRowPatches(patchedServerId, [{
            sessionId: patchedSessionId,
            patch: { metadata: { machineId: 'm-1', path: '/repo-1/moved-project', host: 'host' } },
        }]);
        const structuralPatchMs = performance.now() - structuralStartedAt;

        expect(get().sessionListIndexByServerId[patchedServerId]).not.toBe(indexesAfterIngest[patchedServerId]);
        for (const serverId of homeServerIds.filter((candidate) => candidate !== patchedServerId)) {
            expect(get().sessionListIndexByServerId[serverId]).toBe(indexesAfterIngest[serverId]);
        }

        const RAPID_CHANGE_COUNT = 20;
        const rapidStartedAt = performance.now();
        const setCallsBeforeRapidChanges = getSetCalls();
        for (let change = 0; change < RAPID_CHANGE_COUNT; change += 1) {
            domain.applyServerScopedSessionListRowPatches(patchedServerId, [{
                sessionId: patchedSessionId,
                patch: { seq: 2_000 + change, updatedAt: 5_000 + change },
            }]);
        }
        const rapidChangeMs = performance.now() - rapidStartedAt;
        const rapidChangeSetCalls = getSetCalls() - setCallsBeforeRapidChanges;

        for (const serverId of homeServerIds.filter((candidate) => candidate !== patchedServerId)) {
            expect(get().sessionListIndexByServerId[serverId]).toBe(indexesAfterIngest[serverId]);
        }
        expect(readSessionListIndexSessionIds(get().sessionListIndexByServerId[patchedServerId]))
            .toHaveLength(ROWS_PER_HOME);

        console.info([
            'Lane07 R18 UI ingestion/index cost:',
            `${HOME_COUNT} Homes x ${ROWS_PER_HOME} rows = ${HOME_COUNT * ROWS_PER_HOME} loaded rows`,
            `ingest ${ingestMs.toFixed(1)} ms in ${ingestSetCalls} store writes`,
            `non-structural patch ${nonStructuralPatchMs.toFixed(1)} ms (no index rebuild)`,
            `structural patch ${structuralPatchMs.toFixed(1)} ms (one Home rebuilt)`,
            `${RAPID_CHANGE_COUNT} rapid patches ${rapidChangeMs.toFixed(1)} ms in ${rapidChangeSetCalls} store writes`,
            `platform ${process.platform}/${process.arch}`,
        ].join(', '));
    });
});
