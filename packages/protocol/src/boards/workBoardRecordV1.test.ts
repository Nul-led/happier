import { describe, expect, it } from 'vitest';
import { createWorkBoardRecordPortV1 } from './workBoardRecordV1.js';
import { createWorkBoardV1 } from './workBoardV1.js';

describe('Account KV WorkBoard record owner', () => {
    it('refuses stored JSON null rather than overwriting it as absent, while accepting true missing records', async () => {
        let writes = 0;
        const invalid = createWorkBoardRecordPortV1({ read: async () => ({ value: null, version: 4 }),
            compareAndSet: async () => { writes++; return { success: true, version: 5 }; } });
        await expect(invalid.read()).rejects.toMatchObject({ code: 'invalid_board_record' });
        await expect(invalid.apply({ kind: 'create', board: { id: 'b', name: 'B' } })).rejects.toMatchObject({ code: 'invalid_board_record' });
        expect(writes).toBe(0);
        const absent = createWorkBoardRecordPortV1({ read: async () => ({ value: null, version: -1 }),
            compareAndSet: async () => ({ success: true, version: 0 }) });
        await expect(absent.read()).resolves.toEqual({ v: 1, boards: [] });
    });

    it('replays semantic edits on a conflict and preserves opaque future Boards', async () => {
        const opaque = { id: 'future', futureField: true };
        let value: unknown = { v: 1, boards: [createWorkBoardV1({ id: 'one', name: 'One' })] };
        let version = 0;
        let conflict = true;
        const port = createWorkBoardRecordPortV1({
            read: async () => ({ value, version }),
            compareAndSet: async (next, expected) => {
                expect(expected).toBe(version);
                if (conflict) {
                    conflict = false;
                    value = { v: 1, boards: [createWorkBoardV1({ id: 'one', name: 'Concurrent rename' }), opaque,
                        createWorkBoardV1({ id: 'two', name: 'Another device' })] };
                    return { success: false, value, version: ++version };
                }
                value = next;
                return { success: true, version: ++version };
            },
        });
        const result = await port.apply({ kind: 'update', boardId: 'one', patch: { mode: 'by_status' } });
        expect(result.boards.map(board => [board.id, board.name, board.mode])).toEqual([
            ['one', 'Concurrent rename', 'by_status'], ['two', 'Another device', 'canvas'],
        ]);
        expect(result.unreadable).toEqual([opaque]);
    });

    it('refuses a retired scope before writing the result of an in-flight read', async () => {
        let current = true;
        let writes = 0;
        const port = createWorkBoardRecordPortV1({
            read: async () => { current = false; return { value: null, version: -1 }; },
            compareAndSet: async () => { writes++; return { success: true, version: 0 }; },
        }, { shouldContinue: () => current });
        await expect(port.apply({ kind: 'create', board: { id: 'b', name: 'B' } })).rejects.toMatchObject({ code: 'account_kv_scope_retired' });
        expect(writes).toBe(0);
    });
});
