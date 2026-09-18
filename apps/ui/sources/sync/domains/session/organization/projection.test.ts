import { describe, expect, it } from 'vitest';

import {
    buildSessionOrganizationProjection,
    buildSessionOrganizationProjections,
} from './projection';
import {
    buildSessionOrganizationServerKey,
    buildSessionOrganizationSessionKey,
} from './keys';

const sessionKey = (serverId: string, sessionId: string): string =>
    buildSessionOrganizationSessionKey(serverId, sessionId);

describe('buildSessionOrganizationProjection', () => {
    it('projects only the requested server organization state in pinned order', () => {
        const projection = buildSessionOrganizationProjection({
            schemaVersionByServerId: { 'server-a': 1 },
            snapshotVersionByServerId: { 'server-a': 9 },
            pinsBySessionKey: {
                [sessionKey('server-a', 's2')]: { sessionId: 's2', sortKey: '0002', pinnedAt: 20 },
                [sessionKey('server-a', 's1')]: { sessionId: 's1', sortKey: '0001', pinnedAt: 10 },
                [sessionKey('server-b', 's3')]: { sessionId: 's3', sortKey: '0000', pinnedAt: 1 },
            },
            foldersByFolderKey: {
                [buildSessionOrganizationServerKey('server-a', 'folder-a')]: {
                    folderId: 'folder-a',
                    folderKey: 'folder-a',
                    parentFolderId: null,
                    parentFolderKey: null,
                    sortKey: null,
                    display: null,
                    displayState: { status: 'available', value: null },
                    archivedAt: null,
                    createdAt: 1,
                    updatedAt: 1,
                },
            },
            folderAssignmentsBySessionKey: {
                [sessionKey('server-a', 's1')]: { sessionId: 's1', folderId: 'folder-a' },
            },
            tagsByTagKey: {},
            tagAssignmentsBySessionKey: {
                [sessionKey('server-a', 's1')]: { sessionId: 's1', tagIds: ['tag-a'] },
            },
            attentionStandingsBySessionKey: {
                [sessionKey('server-a', 's1')]: { sessionId: 's1', standing: true, updatedAt: 5 },
                [sessionKey('server-a', 's2')]: { sessionId: 's2', standing: false, updatedAt: 6 },
                [sessionKey('server-b', 's3')]: { sessionId: 's3', standing: true, updatedAt: 7 },
            },
            orderEntriesByScopeKey: {},
            labelsByLabelKey: {},
        }, 'server-a');

        expect(projection.schemaVersion).toBe(1);
        expect(projection.version).toBe(9);
        expect(projection.pinnedSessionIds).toEqual(['s1', 's2']);
        expect(projection.folderAssignmentsBySessionId).toEqual({ s1: 'folder-a' });
        expect(projection.tagAssignmentsBySessionId).toEqual({ s1: ['tag-a'] });
        // An explicit `false` is the user's "remove from Needs attention": it must survive the
        // projection intact, and another server's standings must not leak into this one.
        expect(projection.attentionStandingsBySessionId).toEqual({
            s1: { sessionId: 's1', standing: true, updatedAt: 5 },
            s2: { sessionId: 's2', standing: false, updatedAt: 6 },
        });
        expect(projection.pinsBySessionId.s3).toBeUndefined();
    });

    it('collects one qualified projection for every normalized selected Home', () => {
        const requested: string[] = [];
        const projections = buildSessionOrganizationProjections(
            [' home-a ', 'home-b', 'home-a', ''],
            (serverId) => {
                requested.push(serverId);
                return buildSessionOrganizationProjection({
                    schemaVersionByServerId: { [serverId]: 1 },
                    snapshotVersionByServerId: { [serverId]: 1 },
                    pinsBySessionKey: {},
                    foldersByFolderKey: {},
                    folderAssignmentsBySessionKey: {},
                    tagsByTagKey: {},
                    tagAssignmentsBySessionKey: {},
                    attentionStandingsBySessionKey: {},
                    orderEntriesByScopeKey: {},
                    labelsByLabelKey: {},
                }, serverId);
            },
        );

        expect(requested).toEqual(['home-a', 'home-b']);
        expect(Object.keys(projections)).toEqual(['home-a', 'home-b']);
    });
});
