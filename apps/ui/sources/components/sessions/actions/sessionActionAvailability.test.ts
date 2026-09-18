import { createSessionAccessFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';

import { createSessionActionTarget } from './sessionActionContext';
import {
    SESSION_ACTION_ARCHIVE_ID,
    SESSION_ACTION_DELETE_ID,
    SESSION_ACTION_MOVE_TO_FOLDER_ID,
    SESSION_ACTION_MARK_UNREAD_ID,
    SESSION_ACTION_RENAME_ID,
    SESSION_ACTION_RESUME_ID,
    SESSION_ACTION_STOP_ID,
} from './sessionActionIds';
import { listVisibleSessionActionIds } from './sessionActionAvailability';

function createOwnedRawSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session_resume',
        active: false,
        archivedAt: null,
        owner: 'current_user',
        access: createSessionAccessFixture(),
        seq: 4,
        lastViewedSessionSeq: 4,
        latestTurnStatus: 'completed',
        createdAt: 1,
        updatedAt: 1,
        activeAt: 0,
        metadataLayoutVersion: 1,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: { path: '/shared', host: 'shared' },
        ownerMetadataView: null,
        agentState: null,
        thinking: false,
        thinkingAt: 0,
        presence: 0,
        ...overrides,
    };
}

describe('session action availability', () => {
    it('fails unavailable projections closed despite a matching legacy owner id', () => {
        const target = createSessionActionTarget({ session: createOwnedRawSession({ access: null }), currentUserId: 'current_user' });
        expect(target).toMatchObject({ isOwnedByCurrentUser: false, canUnarchive: false, canStop: false, canArchive: false, canRename: false, canResume: false, canDelete: false });
    });
    it('uses each capability independently of owner role and access level', () => {
        const target = createSessionActionTarget({ session: createOwnedRawSession({ access: createSessionAccessFixture('admin', { manageAccess: false, archiveSession: false, renameSession: true }) }) });
        expect(target).toMatchObject({ canUnarchive: false, canArchive: false, canRename: true });
    });
    it('offers personal Follow to a view-only reader on every single-session host only with exact Home availability', () => {
        const base = createSessionActionTarget({
            session: createOwnedRawSession({ owner: 'someone_else', access: createSessionAccessFixture('view') }),
            serverId: 'home_b',
            currentUserId: 'current_user',
        });
        for (const surface of ['rowMenu', 'nativeContextMenu', 'sessionHeader', 'sessionInfo'] as const) {
            expect(listVisibleSessionActionIds({ target: { ...base, followEnabled: true }, surface }))
                .toContain('ui.session.follow');
            expect(listVisibleSessionActionIds({ target: base, surface })).not.toContain('ui.session.follow');
            expect(listVisibleSessionActionIds({ target: { ...base, serverId: null, followEnabled: true }, surface }))
                .not.toContain('ui.session.follow');
        }
    });
    it('offers standalone Resume only for an inactive resumable owner metadata view', () => {
        const createTarget = (overrides: Partial<Session>) => createSessionActionTarget({
            session: createOwnedRawSession(overrides),
            currentUserId: 'current_user',
            isConnected: overrides.active === true,
            resumeCapabilityOptions: { accountSettings: {} },
        });
        const resumableTarget = createTarget({
            ownerMetadataView: {
                path: '/workspace',
                host: 'machine',
                flavor: 'claude',
                claudeSessionId: 'claude_vendor_session',
                claudeTranscriptPath: '/tmp/claude_vendor_session.jsonl',
            },
        });
        const activeTarget = createTarget({
            active: true,
            ownerMetadataView: {
                path: '/workspace',
                host: 'machine',
                flavor: 'claude',
                claudeSessionId: 'claude_vendor_session',
                claudeTranscriptPath: '/tmp/claude_vendor_session.jsonl',
            },
        });
        const nonResumableTarget = createTarget({
            ownerMetadataView: { path: '/workspace', host: 'machine', flavor: 'unknown-provider' },
        });

        expect(listVisibleSessionActionIds({ target: resumableTarget, surface: 'sessionHeader' }))
            .toContain(SESSION_ACTION_RESUME_ID);
        expect(listVisibleSessionActionIds({ target: activeTarget, surface: 'sessionHeader' }))
            .not.toContain(SESSION_ACTION_RESUME_ID);
        expect(listVisibleSessionActionIds({ target: nonResumableTarget, surface: 'sessionHeader' }))
            .not.toContain(SESSION_ACTION_RESUME_ID);
    });

    it('keeps session-info shared actions as a superset of row lifecycle actions', () => {
        const session: SessionListRenderableSession = {
            id: 'session_1',
            viewer: {
                readState: { state: 'tracking', lastViewedSessionSeq: 4, unreadSince: null },
                relevance: { relevant: true, reasons: ['owned_by_me'] },
                attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' },
                follow: { follows: false, notificationLevel: null },
                notification: { level: 'important', source: 'owner' },
            },
            active: true,
            archivedAt: null,
            owner: 'user_1',
            access: createSessionAccessFixture(),
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        };
        const target = createSessionActionTarget({
            session,
            serverId: 'server_1',
            currentUserId: 'user_1',
            isConnected: true,
            isPinned: false,
        });

        const rowLifecycleActionIds = listVisibleSessionActionIds({
            target,
            surface: 'rowMenu',
        }).filter((id) => id !== SESSION_ACTION_MOVE_TO_FOLDER_ID);
        const infoActionIds = listVisibleSessionActionIds({
            target,
            surface: 'sessionInfo',
        });

        expect(rowLifecycleActionIds).toEqual([
            SESSION_ACTION_MARK_UNREAD_ID,
            SESSION_ACTION_RENAME_ID,
            SESSION_ACTION_STOP_ID,
            SESSION_ACTION_ARCHIVE_ID,
        ]);
        expect(infoActionIds).toEqual(expect.arrayContaining(rowLifecycleActionIds));
    });

    it('keeps delete owner-only for inactive admin-access shared sessions', () => {
        const session: SessionListRenderableSession = {
            id: 'session_shared',
            active: false,
            archivedAt: null,
            owner: 'owner_user',
            access: createSessionAccessFixture('admin'),
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        };

        const target = createSessionActionTarget({
            session,
            serverId: 'server_1',
            currentUserId: 'admin_user',
            isConnected: false,
            isPinned: false,
        });

        expect(target.canUnarchive).toBe(true);
        expect(target.isOwnedByCurrentUser).toBe(false);
        expect(target.canDelete).toBe(false);
        expect(listVisibleSessionActionIds({ target, surface: 'sessionInfo' })).not.toContain(SESSION_ACTION_DELETE_ID);
    });

    it('offers canonical Stop for an owned inactive session with a recoverable preserved terminal host', () => {
        const session: SessionListRenderableSession = {
            id: 'recoverable_session',
            active: false,
            archivedAt: null,
            owner: 'current_user',
            access: createSessionAccessFixture(),
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 0,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: {
                path: '/repo',
                terminalControlServiceabilityV1: {
                    v: 1,
                    state: 'recoverable_unservable',
                    observedAt: 123,
                    reason: 'control_descriptor_missing',
                },
            },
            thinking: false,
            thinkingAt: 0,
            presence: 0,
        };
        const target = createSessionActionTarget({
            session,
            currentUserId: 'current_user',
            isConnected: false,
        });

        expect(listVisibleSessionActionIds({ target, surface: 'sessionInfo' })).toContain(SESSION_ACTION_STOP_ID);
        expect(listVisibleSessionActionIds({ target, surface: 'rowMenu' })).toContain(SESSION_ACTION_STOP_ID);
        expect(target.canDelete).toBe(false);
    });

    it.each([
        ['missing', null],
        ['unknown', { v: 1, state: 'unknown', observedAt: 123 }],
        ['servable', { v: 1, state: 'servable', observedAt: 123 }],
    ])('fails Delete closed for %s terminal lifecycle evidence', (_label, lifecycle) => {
        const session = {
            id: 'delete_fail_closed',
            active: false,
            archivedAt: null,
            owner: 'current_user',
            access: createSessionAccessFixture(),
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 0,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: lifecycle ? { terminalControlServiceabilityV1: lifecycle } : null,
            thinking: false,
            thinkingAt: 0,
            presence: 0,
        } as SessionListRenderableSession;
        expect(createSessionActionTarget({
            session,
            currentUserId: 'current_user',
            isConnected: false,
        }).canDelete).toBe(false);
    });

    it('permits Delete for an inactive owned session with explicit retirement evidence', () => {
        const session = {
            id: 'delete_retired',
            active: false,
            archivedAt: null,
            owner: 'current_user',
            access: createSessionAccessFixture(),
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 0,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: {
                path: '/repo',
                terminalControlServiceabilityV1: {
                    v: 1,
                    state: 'unknown',
                    observedAt: 123,
                    retired: true,
                },
            },
            thinking: false,
            thinkingAt: 0,
            presence: 0,
        } as SessionListRenderableSession;
        expect(createSessionActionTarget({
            session,
            currentUserId: 'current_user',
            isConnected: false,
        }).canDelete).toBe(true);
    });

    it('uses layout-v1 owner terminal lifecycle evidence and never falls back to shared metadata', () => {
        const base: Session = {
            id: 'layout_v1_retired',
            active: false,
            archivedAt: null,
            owner: 'current_user',
            access: createSessionAccessFixture(),
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 0,
            metadataLayoutVersion: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: {
                path: '',
                host: '',
                terminalControlServiceabilityV1: {
                    v: 1,
                    state: 'unknown',
                    observedAt: 123,
                    retired: false,
                },
            },
            agentState: null,
            thinking: false,
            thinkingAt: 0,
            presence: 0,
        };

        expect(createSessionActionTarget({
            session: {
                ...base,
                ownerMetadataView: {
                    path: '',
                    host: '',
                    terminal: {
                        controlServiceabilityV1: {
                            v: 1,
                            state: 'unknown',
                            observedAt: 456,
                            retired: true,
                        },
                    },
                },
            },
            currentUserId: 'current_user',
            isConnected: false,
        }).canDelete).toBe(true);

        expect(createSessionActionTarget({
            session: {
                ...base,
                ownerMetadataView: null,
            },
            currentUserId: 'current_user',
            isConnected: false,
        }).canDelete).toBe(false);
    });
});
