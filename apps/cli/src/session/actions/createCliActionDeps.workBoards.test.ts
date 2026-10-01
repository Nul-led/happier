import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createActionExecutor, createWorkBoardV1, WorkBoardsV1Schema, WORK_BOARDS_ACCOUNT_KV_KEY_V1 as key } from '@happier-dev/protocol';
import { decodeBase64, encodeBase64 } from '@/api/encryption';
import { resetActiveAccountSettingsSnapshotForTests } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { createCliActionDeps } from './createCliActionDeps';

afterEach(() => { vi.restoreAllMocks(); resetActiveAccountSettingsSnapshotForTests(); });
const mutationSchema = z.object({ mutations: z.array(z.object({ key: z.string(), value: z.string(), version: z.number() })) });

describe('CLI Board Action Account KV transport', () => {
    it('replays against a KV conflict and never writes the whole settings document', async () => {
        let record: unknown = null;
        let version = -1;
        let conflict = true;
        const plain = () => encodeBase64(new TextEncoder().encode(JSON.stringify({ t: 'plain', v: record })));
        const get = vi.spyOn(axios, 'get').mockImplementation(async url => {
            if (url.endsWith('/v1/account/encryption')) return { status: 200, data: { mode: 'plain', updatedAt: 1 } };
            if (url.endsWith('/v1/account/encryption/currentness')) return { status: 200, data: { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 } };
            if (url.endsWith('/v2/account/settings')) return { status: 200, data: { content: { t: 'plain', v: { unrelated: 'x'.repeat(600_000) } }, version: 1 } };
            if (url.endsWith(`/v1/kv/${encodeURIComponent(key)}`)) return record === null ? { status: 404 } : { status: 200, data: { key, value: plain(), version } };
            throw new Error(`unexpected_get:${url}`);
        });
        const post = vi.spyOn(axios, 'post').mockImplementation(async (url, body) => {
            if (!url.endsWith('/v1/kv')) throw new Error(`unexpected_post:${url}`);
            const mutation = mutationSchema.parse(body).mutations[0]!;
            expect(mutation.key).toBe(key); expect(mutation.version).toBe(version);
            if (conflict) {
                conflict = false;
                record = { v: 1, boards: [createWorkBoardV1({ id: 'other', name: 'Other device' })] };
                return { status: 409, data: { success: false, errors: [{ key, error: 'version-mismatch', version: ++version, value: plain() }] } };
            }
            record = JSON.parse(new TextDecoder().decode(decodeBase64(mutation.value))).v;
            return { status: 200, data: { success: true, results: [{ key, version: ++version }] } };
        });
        const executor = createActionExecutor(createCliActionDeps({ token: 'board-token', credentials: { token: 'board-token', encryption: null }, sessionId: 'cli-global', mode: 'plain', ctx: null,
            serverId: 'board-home', serverHttpBaseUrl: 'https://board-home.test' }));
        const context = { surface: 'cli', bypassApprovals: true } as const;
        expect(await executor.execute('boards.apply', { intent: { kind: 'create', board: { id: 'b1', name: 'CLI Board' } } }, context)).toMatchObject({ ok: true, result: { board: { id: 'b1' } } });
        expect(await executor.execute('boards.list', {}, context)).toMatchObject({ ok: true, result: { boards: [{ id: 'other' }, { id: 'b1' }] } });
        expect(WorkBoardsV1Schema.parse(record).boards).toHaveLength(2);
        expect(post.mock.calls.every(call => call[0] === 'https://board-home.test/v1/kv')).toBe(true);
        expect(get.mock.calls.filter(call => call[0].includes('/v1/kv/')).every(call => call[0].startsWith('https://board-home.test/'))).toBe(true);
        expect(JSON.stringify(record)).not.toContain('unrelated');
    });
});
