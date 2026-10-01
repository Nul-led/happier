import { createWorkBoardRecordPortV1, DEFAULT_WORK_BOARDS_V1, type WorkBoardRecordTransportV1 } from '@happier-dev/protocol';
import { createWorkBoardSaveQueue } from './workBoardSaveQueue';

export type WorkBoardReadState = Readonly<{ status: 'loading' | 'ready' | 'error'; hasSnapshot: boolean; errorCode?: string }>;

/** The mounted Board projection and optimistic queue share the same domain record port as Actions. */
export function createWorkBoardAccountStore(transport: WorkBoardRecordTransportV1, shouldContinue: () => boolean) {
    let boards = DEFAULT_WORK_BOARDS_V1;
    let version = -1;
    let readState: WorkBoardReadState = shouldContinue() ? { status: 'loading', hasSnapshot: false }
        : { status: 'error', hasSnapshot: false, errorCode: 'account_kv_scope_retired' };
    let references = 0;
    let detach: (() => void) | null = null;
    const listeners = new Set<() => void>();
    const notify = () => { for (const listener of listeners) listener(); };
    const port = createWorkBoardRecordPortV1(transport, { shouldContinue, onRecord: (next, incomingVersion) => {
        if (incomingVersion < version) return;
        version = incomingVersion;
        const unchanged = JSON.stringify(next) === JSON.stringify(boards);
        const alreadyReady = readState.status === 'ready';
        readState = { status: 'ready', hasSnapshot: true };
        if (unchanged) { if (!alreadyReady) notify(); return; }
        const previous = new Map(boards.boards.map(board => [board.id, board]));
        boards = { ...next, boards: next.boards.map(board => {
            const old = previous.get(board.id);
            return old && JSON.stringify(old) === JSON.stringify(board) ? old : board;
        }) };
        notify();
    } });
    const queue = createWorkBoardSaveQueue({ port });
    return {
        queue,
        getBoards: () => boards,
        getReadState: () => readState,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async refresh() {
            if (!shouldContinue()) return;
            if (readState.status === 'error') { readState = { status: 'loading', hasSnapshot: readState.hasSnapshot }; notify(); }
            try { await port.read(); } catch (error) {
                if (!shouldContinue()) return;
                const errorCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
                    ? error.code : 'board_record_unavailable';
                readState = { status: 'error', hasSnapshot: readState.hasSnapshot, errorCode };
                notify();
            }
        },
        /** View subscriptions stop on navigation; already-admitted writes remain owned by the Account lifetime. */
        retainView(start: () => () => void) {
            if (!shouldContinue()) return () => {};
            references++;
            if (references === 1) detach = start();
            return () => { if (references > 0) references--; if (references === 0) { detach?.(); detach = null; } };
        },
        retire() { detach?.(); detach = null; references = 0; queue.reset(); },
    };
}
