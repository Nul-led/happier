import { describe, expect, it } from 'vitest';
import { createWorkBoardArtifactBoundary } from './workBoardArtifactV1.testkit.js';
import { createWorkBoardArtifactPortV1, readWorkBoardArtifactV1 } from './workBoardArtifactV1.js';
import { buildWorkBoardItemKeyV1, createWorkBoardV1 } from './workBoardV1.js';

describe('one Artifact per Board', () => {
    it('acknowledges the actual winner when exact-id create returns a raced existing Board', async () => {
        const b = createWorkBoardArtifactBoundary();
        const port = createWorkBoardArtifactPortV1({ ...b.transport, create: async input => {
            b.add(createWorkBoardV1({ id: input.artifactId, name: 'Other creator' }));
            return b.transport.create(input);
        } });
        const result = await port.apply({ kind: 'create', board: { id: 'one', name: 'My attempted name' } });
        expect(result.boards[0]?.name).toBe('Other creator');
    });
    it('replays two concurrent position intents on the winner without writing another Board', async () => {
        const b = createWorkBoardArtifactBoundary([createWorkBoardV1({ id: 'one', name: 'One' }), createWorkBoardV1({ id: 'two', name: 'Two' })]);
        const first = buildWorkBoardItemKeyV1({ kind: 'session', qualifiedId: { serverId: 'a', id: 'first' } });
        const second = buildWorkBoardItemKeyV1({ kind: 'session', qualifiedId: { serverId: 'b', id: 'second' } });
        const port = createWorkBoardArtifactPortV1(b.transport);
        const other = b.rows.get('two');
        await Promise.all([
            port.apply({ kind: 'set_positions', boardId: 'one', positionsByItemRef: { [first]: { x: 10, y: 20 } } }),
            port.apply({ kind: 'set_positions', boardId: 'one', positionsByItemRef: { [second]: { x: 30, y: 40 } } }),
        ]);
        expect((await port.readBoard('one'))?.positionsByItemRef).toEqual({ [first]: { x: 10, y: 20 }, [second]: { x: 30, y: 40 } });
        expect(b.rows.get('two')).toBe(other);
        expect(b.updates).toEqual(['one', 'one']);
    });

    it('lists pin/name/Inbox metadata from headers without opening any body, and drains Artifact pages', async () => {
        const b = createWorkBoardArtifactBoundary([{ ...createWorkBoardV1({ id: 'one', name: 'Pinned' }), pinnedInSessions: true, source: { picked: [], sections: ['needs_you'] } }, createWorkBoardV1({ id: 'two', name: 'Two' })]);
        const items = (await b.transport.list({ limit: 500 })).items;
        const port = createWorkBoardArtifactPortV1({ ...b.transport, list: async options => options.cursor
            ? { items: [items[1]!] } : { items: [items[0]!], nextCursor: 'next' } });
        expect(await port.list()).toEqual([
            { id: 'one', name: 'Pinned', pinnedInSessions: true, source: { sections: ['needs_you'] } },
            { id: 'two', name: 'Two', pinnedInSessions: false, source: { sections: [] } },
        ]);
        expect(b.reads).toEqual([]);
    });

    it('preserves an unreadable Board, unknown kind, unknown header fields and source values on neighboring edits', async () => {
        const future = { ...createWorkBoardV1({ id: 'future', name: 'Future' }), newField: { retained: true } };
        const picked = { kind: 'future-kind', qualifiedId: { serverId: 'a', id: 'new' } };
        const b = createWorkBoardArtifactBoundary([future, { ...createWorkBoardV1({ id: 'one', name: 'One' }), source: { sections: ['needs_you', 'new-section'], picked: [picked] } }]);
        const one = b.rows.get('one')!;
        b.rows.set('one', { ...one, header: { ...one.header, extra: 'retained' } });
        b.rows.set('other-kind', { artifactId: 'other-kind', header: { kind: 'future-board.v2' }, body: 'opaque', revision: { headerVersion: 1, bodyVersion: 1 } });
        const untouched = b.rows.get('future');
        const port = createWorkBoardArtifactPortV1(b.transport);
        await port.apply({ kind: 'update', boardId: 'one', patch: { pinnedInSessions: true, name: 'Renamed' } });
        expect(b.rows.get('future')).toBe(untouched);
        expect(b.rows.get('other-kind')?.body).toBe('opaque');
        expect(b.rows.get('one')?.header).toMatchObject({ title: 'Renamed', pinnedInSessions: true, extra: 'retained' });
        const read = await port.read();
        expect(read.unreadable).toEqual([future]);
        expect(read.boards[0]?.source.unknown).toEqual({ sections: ['new-section'], picked: [picked] });
        await expect(port.apply({ kind: 'update', boardId: 'future', patch: { name: 'Wrong' } })).rejects.toMatchObject({ code: 'invalid_board_record' });
    });

    it('refuses a retired Home/Account after an in-flight read and on Retry', async () => {
        const b = createWorkBoardArtifactBoundary([createWorkBoardV1({ id: 'one', name: 'One' })]);
        let current = true;
        const port = createWorkBoardArtifactPortV1({ ...b.transport, read: async id => {
            const row = await b.transport.read(id); current = false; return row;
        } }, { shouldContinue: () => current });
        const intent = { kind: 'update', boardId: 'one', patch: { name: 'Wrong Account' } } as const;
        await expect(port.apply(intent)).rejects.toMatchObject({ code: 'board_scope_retired' });
        await expect(port.apply(intent)).rejects.toMatchObject({ code: 'board_scope_retired' });
        expect(b.updates).toEqual([]);
    });

    it('does not interpret a same-id non-Board Artifact as Board content', async () => {
        const b = createWorkBoardArtifactBoundary([createWorkBoardV1({ id: 'one', name: 'One' })]);
        const row = b.rows.get('one')!;
        expect(() => readWorkBoardArtifactV1({ ...row, header: { kind: 'role.v1' } })).toThrowError('invalid_board_record');
    });
});
