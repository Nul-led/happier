import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_PLAIN_DATA_KEY_MARKER, encodePlainArtifactStoredContent, decodePlainArtifactStoredContent,
    WorkBoardV1Schema, buildWorkBoardItemKeyV1, createActionExecutor, createWorkBoardV1 } from '@happier-dev/protocol';
import { resetActiveAccountSettingsSnapshotForTests } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { createCliActionDeps } from './createCliActionDeps';

afterEach(() => { vi.restoreAllMocks(); resetActiveAccountSettingsSnapshotForTests(); });

describe('CLI Board Actions through the Artifact owner', () => {
    it('writes one Board, replays a position conflict, and leaves another Board and settings untouched', async () => {
        const key = buildWorkBoardItemKeyV1({ kind: 'session', qualifiedId: { serverId: 'board-home', id: 's1' } });
        const otherKey = buildWorkBoardItemKeyV1({ kind: 'session', qualifiedId: { serverId: 'board-home', id: 's2' } });
        let board = createWorkBoardV1({ id: 'b1', name: 'CLI Board' });
        const other = createWorkBoardV1({ id: 'other', name: 'Other Board' });
        let version = 1;
        let conflict = true;
        const row = (id: string) => ({ id, header: encodePlainArtifactStoredContent({ kind: 'work-board.v1', v: 1, title: id === 'b1' ? board.name : other.name, pinnedInSessions: false }),
            body: encodePlainArtifactStoredContent({ body: JSON.stringify(id === 'b1' ? board : other) }), headerVersion: version, bodyVersion: version,
            dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER, seq: version, createdAt: 1, updatedAt: version,
            ownerAccountId: 'owner', access: 'owner', encryptionMode: 'plain' });
        const get = vi.spyOn(axios, 'get').mockImplementation(async url => {
            if (url.endsWith('/v1/account/encryption')) return { status: 200, data: { mode: 'plain', updatedAt: 1 } };
            if (url.endsWith('/v2/account/settings')) return { status: 200, data: { content: { t: 'plain', v: { unrelated: 'x'.repeat(600_000) } }, version: 1 } };
            if (url.includes('/v1/artifacts?')) return { status: 200, data: [row('b1'), row('other')] };
            if (url.endsWith('/v1/artifacts/b1')) return { status: 200, data: row('b1') };
            if (url.endsWith('/v1/artifacts/other')) return { status: 200, data: row('other') };
            // The legacy path has a real empty response, so missing mock setup cannot supply RED.
            if (url.includes('/v1/kv/')) return { status: 404 };
            throw new Error(`unexpected_get:${url}`);
        });
        const post = vi.spyOn(axios, 'post').mockImplementation(async (url, body) => {
            expect(url).toBe('https://board-home.test/v1/artifacts/b1');
            const write = body as { body: string; expectedBodyVersion: number };
            expect(write.expectedBodyVersion).toBe(version);
            if (conflict) {
                conflict = false;
                board = { ...board, positionsByItemRef: { [otherKey]: { x: 3, y: 4 } } };
                version++;
                return { status: 200, data: { success: false, error: 'version-mismatch' } };
            }
            const opened = decodePlainArtifactStoredContent(write.body);
            if (!opened || typeof opened !== 'object' || !('body' in opened) || typeof opened.body !== 'string') throw new Error('invalid Artifact body');
            board = WorkBoardV1Schema.parse(JSON.parse(opened.body));
            version++;
            return { status: 200, data: { success: true, headerVersion: version, bodyVersion: version } };
        });
        const executor = createActionExecutor(createCliActionDeps({ token: 'board-token', credentials: { token: 'board-token', encryption: null }, sessionId: 'cli-global', mode: 'plain', ctx: null,
            serverId: 'board-home', serverHttpBaseUrl: 'https://board-home.test' }));
        const context = { surface: 'cli', bypassApprovals: true } as const;
        await executor.execute('boards.apply', { intent: { kind: 'set_positions', boardId: 'b1', positionsByItemRef: { [key]: { x: 48, y: 96 } } } }, context);
        expect(board.positionsByItemRef).toEqual({ [key]: { x: 48, y: 96 }, [otherKey]: { x: 3, y: 4 } });
        expect(await executor.execute('boards.list', {}, context)).toMatchObject({ ok: true, result: { boards: [{ id: 'b1' }, { id: 'other' }] } });
        expect(post.mock.calls.every(call => call[0] === 'https://board-home.test/v1/artifacts/b1')).toBe(true);
        expect(get.mock.calls.some(call => call[0].includes('/v1/kv/'))).toBe(false);
    });
});
