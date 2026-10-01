import { describe, expect, it } from 'vitest';
import { buildWorkBoardItemKeyV1, createWorkBoardV1, WorkBoardsV1Schema, type BoardItemRefV1, type WorkBoardsV1 } from '@happier-dev/protocol';
import { createWorkBoardAccountStore } from './workBoardAccountStore';
import { projectDisplayedWorkBoards } from './workBoardSaveQueue';

const session = (id: string): BoardItemRefV1 => ({ kind: 'session', qualifiedId: { serverId: 'home-a', id } });
const base = WorkBoardsV1Schema.parse({ v: 1, boards: [{ ...createWorkBoardV1({ id: 'b1', name: 'Overview' }), source: { picked: [session('s1')] } }] });

/** KV CAS is the persistence boundary; reducer, rebase, queue and projection remain real. */
function boundary() {
    let value: unknown = base;
    let version = 0;
    let gate: Promise<void> = Promise.resolve();
    let current = true;
    let unavailable = false;
    const store = createWorkBoardAccountStore({
        read: async () => { await gate; if (unavailable) throw new Error('offline'); return { value, version }; },
        compareAndSet: async (next, expected) => {
            if (expected !== version) return { success: false, value, version };
            value = next;
            return { success: true, version: ++version };
        },
    }, () => current);
    return { store, acknowledged: () => WorkBoardsV1Schema.parse(value), replace: (next: unknown) => { value = next; version++; },
        retire: () => { current = false; }, offline: (next: boolean) => { unavailable = next; },
        hold() { let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; }); return release; } };
}

describe('WorkBoard Account KV save queue', () => {
    it('settles an admitted edit after the last Board view detaches', async () => {
        const b = boundary();
        const releaseView = b.store.retainView(() => () => {});
        const releaseTransport = b.hold();
        const saving = b.store.queue.dispatch({ kind: 'update', boardId: 'b1', patch: { name: 'After navigation' } });
        releaseView(); releaseTransport(); await saving;
        expect(b.acknowledged().boards[0]!.name).toBe('After navigation');
        expect(b.store.queue.getState()).toEqual({ pending: [], failure: null });
    });

    it('exposes an unavailable refresh with Retry while retaining the acknowledged record', async () => {
        const b = boundary();
        await b.store.refresh(); b.offline(true);
        await b.store.refresh();
        expect(b.store.getReadState()).toMatchObject({ status: 'error', hasSnapshot: true });
        expect(b.store.getBoards()).toEqual(base);
        b.offline(false); await b.store.refresh();
        expect(b.store.getReadState()).toMatchObject({ status: 'ready', hasSnapshot: true });
    });

    it('does not render a malformed stored record as an empty collection', async () => {
        const b = boundary();
        await b.store.refresh(); b.replace(null);
        await b.store.refresh();
        expect(b.store.getReadState()).toMatchObject({ status: 'error', hasSnapshot: true, errorCode: 'invalid_board_record' });
        expect(b.store.getBoards()).toEqual(base);
        b.replace(base); await b.store.refresh();
        expect(b.store.getReadState()).toMatchObject({ status: 'ready', hasSnapshot: true });
    });

    it('keeps a newer write acknowledgement when an older refresh returns later', async () => {
        let value = base;
        let version = 0;
        let resolveOld!: (value: { value: WorkBoardsV1; version: number }) => void;
        let first = true;
        const store = createWorkBoardAccountStore({
            read: async () => {
                if (first) { first = false; return await new Promise(resolve => { resolveOld = resolve; }); }
                return { value, version };
            },
            compareAndSet: async next => { value = next; return { success: true, version: ++version }; },
        }, () => true);
        const refresh = store.refresh();
        await store.queue.dispatch({ kind: 'update', boardId: 'b1', patch: { name: 'Newer' } });
        resolveOld({ value: base, version: 0 }); await refresh;
        expect(store.getBoards().boards[0]!.name).toBe('Newer');
    });

    it('projects an edit immediately and keeps it once the dedicated record acknowledges it', async () => {
        const b = boundary();
        await b.store.refresh();
        const release = b.hold();
        const key = buildWorkBoardItemKeyV1(session('s1'));
        const saving = b.store.queue.dispatch({ kind: 'set_positions', boardId: 'b1', positionsByItemRef: { [key]: { x: 48, y: 96 } } });
        expect(projectDisplayedWorkBoards(b.store.getBoards(), b.store.queue.getState().pending).boards[0]!.positionsByItemRef).toEqual({ [key]: { x: 48, y: 96 } });
        release(); await saving;
        expect(b.store.queue.getState()).toEqual({ pending: [], failure: null });
        expect(b.store.getBoards().boards[0]!.positionsByItemRef).toEqual({ [key]: { x: 48, y: 96 } });
    });

    it('saves membership larger than Account settings bounds without dropping valid items', async () => {
        const b = boundary();
        await b.store.queue.dispatch({ kind: 'add_items', boardId: 'b1', refs: Array.from({ length: 300 }, (_, i) => session(`extra-${i}`)) });
        expect(b.store.queue.getState().failure).toBeNull();
        expect(b.acknowledged().boards[0]!.source.picked).toHaveLength(301);
    });

    it('retains acknowledged data on unavailable writes and retries the same semantic intent', async () => {
        const b = boundary();
        await b.store.refresh(); b.offline(true);
        await b.store.queue.dispatch({ kind: 'update', boardId: 'b1', patch: { mode: 'by_status' } });
        expect(b.store.queue.getState().failure?.reason).toBe('unavailable');
        expect(b.store.getBoards().boards[0]!.mode).toBe('canvas');
        b.offline(false); await b.store.queue.retry();
        expect(b.store.queue.getState().failure).toBeNull();
        expect(b.store.getBoards().boards[0]!.mode).toBe('by_status');
    });

    it('does not commit queued intents after their scope retires, including Retry', async () => {
        const b = boundary();
        const release = b.hold();
        const saving = b.store.queue.dispatch({ kind: 'create', board: { id: 'new', name: 'New' } });
        await Promise.resolve(); b.retire(); release(); await saving;
        expect(b.acknowledged()).toEqual(base);
        expect(b.store.queue.getState().failure?.reason).toBe('unavailable');
        await b.store.queue.retry();
        expect(b.acknowledged()).toEqual(base);
    });
});
