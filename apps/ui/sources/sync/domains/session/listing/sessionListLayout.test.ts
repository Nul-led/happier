import { describe, expect, it, vi } from 'vitest';

import {
    normalizeSessionListSectionModeV1,
    resolveSessionListLayoutApplicability,
    resolveSessionListLayoutPresentation,
    resolveSessionListLayoutChoice,
    resolveSessionListLayoutSettingsDelta,
    resolveSessionListSessionRowDragPolicy,
    projectSessionListIndexForLayout,
} from './sessionListLayout';
import { resolveSessionListGroupingModes } from './resolveSessionListGroupingModes';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import type { SessionListRenderableSession } from './sessionListRenderable';

describe('session list layout projection', () => {
    it('projects missing current settings to Projects', () => {
        expect(normalizeSessionListSectionModeV1(undefined)).toBe('single');
        expect(resolveSessionListLayoutChoice({})).toBe('projects');
    });

    it('derives all three choices from the incumbent settings', () => {
        expect(resolveSessionListLayoutChoice({
            sessionListSectionModeV1: 'single',
            sessionListActiveGroupingV1: 'project',
        })).toBe('projects');
        expect(resolveSessionListLayoutChoice({
            sessionListSectionModeV1: 'single',
            sessionListActiveGroupingV1: 'date',
        })).toBe('recent_activity');
        expect(resolveSessionListLayoutChoice({
            sessionListSectionModeV1: 'activity',
            sessionListActiveGroupingV1: 'date',
        })).toBe('active_inactive');
    });

    it('lets a transient route intent select the layout without changing stored settings', () => {
        const savedProjects = {
            sessionListSectionModeV1: 'single' as const,
            sessionListActiveGroupingV1: 'project' as const,
        };

        expect(resolveSessionListLayoutChoice(savedProjects, 'recent_activity')).toBe('recent_activity');
        expect(resolveSessionListLayoutChoice(savedProjects, null)).toBe('projects');
        expect(resolveSessionListLayoutChoice(savedProjects)).toBe('projects');
        expect(savedProjects).toEqual({
            sessionListSectionModeV1: 'single',
            sessionListActiveGroupingV1: 'project',
        });
    });

    it('returns one atomic delta while preserving dormant preferences', () => {
        const current = {
            sessionListSectionModeV1: 'activity' as const,
            sessionListActiveGroupingV1: 'date' as const,
            sessionListInactiveGroupingV1: 'project' as const,
            sessionListOrderingModeV1: 'created' as const,
        };

        expect(resolveSessionListLayoutSettingsDelta('projects', current)).toEqual({
            sessionListSectionModeV1: 'single',
            sessionListActiveGroupingV1: 'project',
        });
        expect(resolveSessionListLayoutSettingsDelta('recent_activity', current)).toEqual({
            sessionListSectionModeV1: 'single',
            sessionListActiveGroupingV1: 'date',
        });
        expect(resolveSessionListLayoutSettingsDelta('active_inactive', current)).toEqual({
            sessionListSectionModeV1: 'activity',
        });
    });

    it('resolves grouping from the canonical enums only and ignores the released legacy inactive-project Boolean', () => {
        expect(resolveSessionListGroupingModes({ inactiveGroupingV1: 'project' }).inactiveGrouping).toBe('project');
        expect(resolveSessionListGroupingModes({ inactiveGroupingV1: 'date' }).inactiveGrouping).toBe('date');
        expect(resolveSessionListGroupingModes({}).inactiveGrouping).toBe('date');

        // The released Protocol schema and its compatibility migration keep the
        // predecessor `groupInactiveSessionsByProject` Boolean, but the runtime
        // grouping decision consumes only the canonical current enum.
        const predecessorShape = {
            groupInactiveSessionsByProject: true,
        } as unknown as Parameters<typeof resolveSessionListGroupingModes>[0];
        expect(resolveSessionListGroupingModes(predecessorShape).inactiveGrouping).toBe('date');
    });

    it('presents Recent activity as one flat cross-Home timeline with row badges', () => {
        expect(resolveSessionListLayoutPresentation('recent_activity', 'grouped')).toBe('flat-with-badge');
        expect(resolveSessionListLayoutPresentation('recent_activity', 'flat-with-badge')).toBe('flat-with-badge');
        expect(resolveSessionListLayoutPresentation('projects', 'grouped')).toBe('grouped');
        expect(resolveSessionListLayoutPresentation('active_inactive', 'flat-with-badge')).toBe('flat-with-badge');
    });

    it('disables project and folder presentation for Recent activity', () => {
        expect(resolveSessionListLayoutApplicability({
            choice: 'recent_activity',
            inactiveGroupingV1: 'project',
            folderViewModeV1: 'tree',
            foldersFeatureEnabled: true,
        })).toEqual({
            usesProjectGrouping: false,
            usesFolderTreePresentation: false,
            showsAdvancedSectionGrouping: false,
        });
        expect(resolveSessionListLayoutApplicability({
            choice: 'active_inactive',
            activeGroupingV1: 'date',
            inactiveGroupingV1: 'project',
            folderViewModeV1: 'tree',
            foldersFeatureEnabled: true,
        })).toEqual({
            usesProjectGrouping: true,
            usesFolderTreePresentation: true,
            showsAdvancedSectionGrouping: true,
        });
    });

    it('advertises only drag operations the effective group policy can commit', () => {
        expect(resolveSessionListSessionRowDragPolicy({
            manualSessionOrderingEnabled: true,
            folderContainmentEnabled: false,
            item: { section: 'active', groupKind: 'date' },
            sectionModeV1: 'activity',
            orderingModeV1: 'custom',
        })).toEqual({
            canReorderSiblings: false,
            canMoveBetweenFolders: false,
            canPutUnder: false,
            canDrag: false,
        });

        expect(resolveSessionListSessionRowDragPolicy({
            manualSessionOrderingEnabled: true,
            folderContainmentEnabled: true,
            item: { section: 'active', groupKind: 'date' },
            sectionModeV1: 'activity',
            orderingModeV1: 'custom',
        })).toEqual({
            canReorderSiblings: false,
            canMoveBetweenFolders: true,
            canPutUnder: false,
            canDrag: true,
        });

        expect(resolveSessionListSessionRowDragPolicy({
            manualSessionOrderingEnabled: false,
            folderContainmentEnabled: false,
            item: { section: 'active', groupKind: 'project' },
            sectionModeV1: 'single',
            orderingModeV1: 'custom',
        })).toEqual({
            canReorderSiblings: false,
            canMoveBetweenFolders: false,
            canPutUnder: false,
            canDrag: false,
        });

        // Putting a Session under a lead is its own drag, available whatever the ordering or folders.
        expect(resolveSessionListSessionRowDragPolicy({
            manualSessionOrderingEnabled: false,
            folderContainmentEnabled: false,
            putUnderEnabled: true,
            item: { section: 'active', groupKind: 'project' },
            sectionModeV1: 'single',
            orderingModeV1: 'updated',
        })).toEqual({
            canReorderSiblings: false,
            canMoveBetweenFolders: false,
            canPutUnder: true,
            canDrag: true,
        });
    });

    it('retains unresolved qualified members as one loading tail group and rehomes them after hydration', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 17, 18, 0));
        const source: SessionListIndexItem[] = [
            { type: 'header', headerKind: 'sessions', title: 'Sessions', serverId: 'home-a' },
            { type: 'session', sessionId: 'hydrated', serverId: 'home-a', section: 'active', groupKey: 'a', groupKind: 'project' },
            { type: 'session', sessionId: 'pending', serverId: 'home-b', section: 'active', groupKey: 'b', groupKind: 'project' },
        ];
        const hydratedRow = {
            id: 'hydrated',
            active: true,
            createdAt: 100,
            meaningfulActivityAt: new Date(2026, 4, 17, 8, 0).getTime(),
            metadata: null,
        } as SessionListRenderableSession;
        const pendingRow = {
            id: 'pending',
            active: true,
            createdAt: 200,
            meaningfulActivityAt: new Date(2026, 4, 17, 12, 0).getTime(),
            metadata: null,
        } as SessionListRenderableSession;

        const whileLoading = projectSessionListIndexForLayout({
            source,
            choice: 'recent_activity',
            resolveSessionRow: (serverId, sessionId) => (
                serverId === 'home-a' && sessionId === 'hydrated' ? hydratedRow : null
            ),
        });

        expect(whileLoading.map((item) => item.type === 'header'
            ? `header:${item.headerKind}`
            : `session:${item.serverId}:${item.sessionId}:${item.groupKind}`,
        )).toEqual([
            'header:date',
            'session:home-a:hydrated:date',
            'header:loading',
            'session:home-b:pending:loading',
        ]);

        const afterHydration = projectSessionListIndexForLayout({
            source,
            choice: 'recent_activity',
            resolveSessionRow: (serverId, sessionId) => {
                if (serverId === 'home-a' && sessionId === 'hydrated') return hydratedRow;
                if (serverId === 'home-b' && sessionId === 'pending') return pendingRow;
                return null;
            },
        });

        expect(afterHydration.map((item) => item.type === 'header'
            ? `header:${item.headerKind}`
            : `session:${item.serverId}:${item.sessionId}:${item.groupKind}`,
        )).toEqual([
            'header:date',
            'session:home-b:pending:date',
            'session:home-a:hydrated:date',
        ]);
        vi.useRealTimers();
    });

    it('keeps an unresolved qualified member visible under hidden-inactive rules', () => {
        const projected = projectSessionListIndexForLayout({
            source: [
                { type: 'session', sessionId: 'pending', serverId: 'home-b', groupKey: 'b', groupKind: 'project' },
            ],
            choice: 'recent_activity',
            resolveSessionRow: () => null,
        });

        expect(projected.filter((item) => item.type === 'session')).toEqual([
            expect.objectContaining({ sessionId: 'pending', serverId: 'home-b', section: 'active', groupKind: 'loading' }),
        ]);
    });

    it('builds one qualified cross-Home timeline without structural source headers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 17, 18, 0));
        const source: SessionListIndexItem[] = [
            { type: 'header', headerKind: 'server', title: 'Home A', serverId: 'home-a' },
            { type: 'header', headerKind: 'sessions', title: 'Sessions', serverId: 'home-a' },
            { type: 'header', headerKind: 'project', title: 'Repo A', serverId: 'home-a', groupKey: 'a-project' },
            { type: 'session', sessionId: 'same', serverId: 'home-a', section: 'active', groupKey: 'a-project', groupKind: 'project' },
            { type: 'header', headerKind: 'server', title: 'Home B', serverId: 'home-b' },
            { type: 'header', headerKind: 'project', title: 'Repo B', serverId: 'home-b', groupKey: 'b-project' },
            { type: 'session', sessionId: 'same', serverId: 'home-b', section: 'inactive', groupKey: 'b-project', groupKind: 'project' },
        ];
        const rows: Record<string, SessionListRenderableSession> = {
            'home-a:same': {
                id: 'same',
                active: true,
                createdAt: 100,
                meaningfulActivityAt: new Date(2026, 4, 17, 8, 0).getTime(),
                updatedAt: new Date(2026, 4, 17, 18, 0).getTime(),
                metadata: null,
            } as SessionListRenderableSession,
            'home-b:same': {
                id: 'same',
                active: false,
                createdAt: 200,
                meaningfulActivityAt: new Date(2026, 4, 17, 12, 0).getTime(),
                updatedAt: new Date(2026, 4, 16, 18, 0).getTime(),
                metadata: null,
            } as SessionListRenderableSession,
        };

        const projected = projectSessionListIndexForLayout({
            source,
            choice: 'recent_activity',
            resolveSessionRow: (serverId, sessionId) => rows[`${serverId}:${sessionId}`] ?? null,
        });

        expect(projected.map((item) => item.type === 'header'
            ? `header:${item.headerKind}:${item.title}`
            : `session:${item.serverId}:${item.sessionId}:${item.groupKind}`,
        )).toEqual([
            'header:date:Today',
            'session:home-b:same:date',
            'session:home-a:same:date',
        ]);
        vi.useRealTimers();
    });
});
