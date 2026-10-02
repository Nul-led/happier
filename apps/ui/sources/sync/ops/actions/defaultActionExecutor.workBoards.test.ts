import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { installApprovalCommonModuleMocks } from '@/components/approvals/approvalsTestHelpers';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { createAccountTokenForTests } from '@/dev/testkit/harness/homeGovernanceHarness';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { retireActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { invalidateAccountEncryptionModeCache } from '@/sync/api/account/apiAccountEncryptionMode';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { getStorage } from '@/sync/domains/state/storage';
import { setRuntimeFetch, resetRuntimeFetch } from '@/utils/system/runtimeFetch';
import { ARTIFACT_PLAIN_DATA_KEY_MARKER, encodePlainArtifactStoredContent, decodePlainArtifactStoredContent,
    createWorkBoardV1, buildWorkBoardItemKeyV1, WorkBoardV1Schema } from '@happier-dev/protocol';
import { createDefaultActionExecutor } from './defaultActionExecutor';

// Only HTTP, credentials and native UI modules are replaced; domain and encryption owners run.
installApprovalCommonModuleMocks();
const initialState = getStorage().getState();
afterEach(() => {
    retireActiveServerAccountScopeLifetime(); resetRuntimeFetch(); invalidateAccountEncryptionModeCache();
    resetServerFeaturesClientForTests(); getStorage().setState(initialState, true); vi.restoreAllMocks();
});
const writeSchema = z.object({ header: z.string(), body: z.string(), expectedBodyVersion: z.number(), expectedHeaderVersion: z.number() });

describe('Board Actions through captured Home Artifacts', () => {
    it('rebases a Board conflict on the captured Home and deletes through the Artifact revision owner', async () => {
        const target = await upsertAndActivateServer({ serverUrl: 'https://board-target.test', scope: 'tab' });
        await upsertAndActivateServer({ serverUrl: 'https://board-focused.test', scope: 'tab' });
        const token = createAccountTokenForTests('board-owner');
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token });
        const first = buildWorkBoardItemKeyV1({ kind: 'session', qualifiedId: { serverId: target.id, id: 's1' } });
        const second = buildWorkBoardItemKeyV1({ kind: 'session', qualifiedId: { serverId: target.id, id: 's2' } });
        let board = createWorkBoardV1({ id: 'mine', name: 'My Board' });
        let version = 1;
        let conflict = true;
        let deleted = false;
        const requests: string[] = [];
        const row = () => ({ id: board.id,
            header: encodePlainArtifactStoredContent({ kind: 'work-board.v1', v: 1, title: board.name, pinnedInSessions: board.pinnedInSessions, readsNeedsYou: false }),
            body: encodePlainArtifactStoredContent({ body: JSON.stringify(board) }),
            headerVersion: version, bodyVersion: version, dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
            seq: version, createdAt: 1, updatedAt: version, ownerAccountId: 'board-owner', access: 'owner', encryptionMode: 'plain' });
        setRuntimeFetch(async (input, init) => {
            const url = new URL(String(input));
            expect(url.origin).toBe('https://board-target.test');
            expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
            const method = init?.method ?? 'GET';
            requests.push(`${method} ${url.pathname}`);
            if (url.pathname === '/v1/account/encryption') return Response.json({ mode: 'plain', updatedAt: 1 });
            if (url.pathname === '/v2/account/settings') return Response.json({ content: { t: 'plain', v: { unrelated: 'x'.repeat(600_000) } }, version: 1 });
            if (url.pathname === '/v1/artifacts') return Response.json(deleted ? [] : [row()]);
            if (url.pathname === '/v1/artifacts/mine' && method === 'GET') return deleted ? Response.json({ error: 'not_found' }, { status: 404 }) : Response.json(row());
            if (url.pathname === '/v1/artifacts/mine' && method === 'POST') {
                const write = writeSchema.parse(JSON.parse(String(init?.body)));
                expect(write.expectedBodyVersion).toBe(version);
                if (conflict) {
                    conflict = false; version++;
                    board = { ...board, positionsByItemRef: { [second]: { x: 3, y: 4 } } };
                    return Response.json({ success: false, error: 'version-mismatch' });
                }
                const opened = z.object({ body: z.string() }).parse(decodePlainArtifactStoredContent(write.body));
                board = WorkBoardV1Schema.parse(JSON.parse(opened.body)); version++;
                return Response.json({ success: true, headerVersion: version, bodyVersion: version });
            }
            if (url.pathname === '/v1/artifacts/mine/revision/3/3' && method === 'DELETE') {
                deleted = true; return Response.json({ success: true });
            }
            return Response.json({ error: 'not_found' }, { status: 404 });
        });
        const executor = createDefaultActionExecutor();
        const context = { serverId: target.id, surface: 'ui', bypassApprovals: true } as const;
        expect(await executor.execute('boards.apply', { intent: { kind: 'set_positions', boardId: 'mine', positionsByItemRef: { [first]: { x: 48, y: 96 } } } }, context))
            .toMatchObject({ ok: true, result: { board: { positionsByItemRef: { [first]: { x: 48, y: 96 }, [second]: { x: 3, y: 4 } } } } });
        expect(await executor.execute('boards.list', {}, context)).toMatchObject({ ok: true, result: { boards: [{ id: 'mine' }] } });
        expect(await executor.execute('boards.apply', { intent: { kind: 'delete', boardId: 'mine' } }, context)).toMatchObject({ ok: true });
        expect(deleted).toBe(true);
        expect(requests).not.toContain('POST /v2/account/settings');
    });
});
