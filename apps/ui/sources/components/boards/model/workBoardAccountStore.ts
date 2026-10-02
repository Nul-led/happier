import { createWorkBoardArtifactPortV1, buildWorkBoardArtifactHeaderV1, readWorkBoardArtifactSummaryV1,
    DEFAULT_WORK_BOARDS_V1, type WorkBoardArtifactTransportV1, type WorkBoardArtifactSummaryV1,
    type WorkBoardArtifactRevisionV1, type WorkBoardV1 } from '@happier-dev/protocol';
import { createWorkBoardSaveQueue } from './workBoardSaveQueue';

export type WorkBoardReadState = Readonly<{ status: 'loading' | 'ready' | 'error'; hasSnapshot: boolean; errorCode?: string }>;

/** Scoped Artifact projection. Headers serve chrome; bodies load only for mounted Board consumers. */
export function createWorkBoardAccountStore(transport: WorkBoardArtifactTransportV1, shouldContinue: () => boolean) {
    let boards = DEFAULT_WORK_BOARDS_V1;
    let summaries: readonly WorkBoardArtifactSummaryV1[] = [];
    const revisions = new Map<string, WorkBoardArtifactRevisionV1>();
    const demand = new Map<string, number>();
    let writes = 0;
    let readState: WorkBoardReadState = shouldContinue() ? { status: 'loading', hasSnapshot: false }
        : { status: 'error', hasSnapshot: false, errorCode: 'board_scope_retired' };
    let references = 0;
    let detach: (() => void) | null = null;
    const listeners = new Set<() => void>();
    const notify = () => { for (const listener of listeners) listener(); };
    const acceptBoard = (id: string, board: WorkBoardV1 | null, revision?: WorkBoardArtifactRevisionV1) => {
        const current = revisions.get(id);
        if (revision && current && (revision.bodyVersion < current.bodyVersion || revision.headerVersion < current.headerVersion)) return;
        if (revision) revisions.set(id, revision);
        else if (!board) revisions.delete(id);
        const old = boards.boards.find(item => item.id === id);
        if (JSON.stringify(board) === JSON.stringify(old ?? null)) return;
        boards = { ...boards, boards: board
            ? old ? boards.boards.map(item => item.id === id ? board : item) : [...boards.boards, board]
            : boards.boards.filter(item => item.id !== id) };
        notify();
    };
    const reconcileSummaries = (next: readonly WorkBoardArtifactSummaryV1[]) => {
        if (JSON.stringify(next) === JSON.stringify(summaries)) return;
        const previous = new Map(summaries.map(item => [item.id, item]));
        summaries = next.map(item => {
            const old = previous.get(item.id);
            return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
        });
        notify();
    };
    const port = createWorkBoardArtifactPortV1(transport, { shouldContinue, onBoard: acceptBoard });
    const queue = createWorkBoardSaveQueue({ port: { read: port.read, apply: async (intent, signal) => {
        const result = await port.apply(intent, signal);
        writes++;
        const id = intent.kind === 'create' ? intent.board.id : intent.boardId;
        const board = result.boards[0];
        const summary = board ? readWorkBoardArtifactSummaryV1(id, buildWorkBoardArtifactHeaderV1(board)) : null;
        const previous = summaries.find(item => item.id === id);
        reconcileSummaries(summary ? previous ? summaries.map(item => item.id === id ? summary : item) : [...summaries, summary]
            : summaries.filter(item => item.id !== id));
        return result;
    } } });
    return {
        queue,
        getBoards: () => boards,
        getSummaries: () => summaries,
        getReadState: () => readState,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async refresh() {
            if (!shouldContinue()) return;
            if (readState.status === 'error') { readState = { status: 'loading', hasSnapshot: readState.hasSnapshot }; notify(); }
            try {
                const before = writes;
                const next = await port.list();
                if (!shouldContinue()) return;
                // A delayed inventory cannot erase a newer local create/delete acknowledgement.
                if (before === writes) {
                    reconcileSummaries(next);
                    const ids = new Set(next.map(item => item.id));
                    for (const old of boards.boards) if (!ids.has(old.id)) acceptBoard(old.id, null);
                }
                const wanted = demand.has('all') || demand.size === 0
                    ? summaries.map(item => item.id) : [...demand.keys()].filter(id => id.startsWith('board:')).map(id => id.slice(6));
                // Independent reads overlap; publish in inventory order so initial selection stays stable.
                const loaded = new Map<string, readonly [WorkBoardV1 | null, WorkBoardArtifactRevisionV1 | undefined]>();
                const reader = createWorkBoardArtifactPortV1(transport, { shouldContinue,
                    onBoard: (id, board, revision) => { loaded.set(id, [board, revision]); },
                });
                await Promise.all(wanted.map(id => reader.readBoard(id)));
                if (!shouldContinue()) return;
                // A body requested before a local deletion must not resurrect that Board.
                if (before === writes) for (const id of wanted) {
                    const acknowledged = loaded.get(id);
                    if (acknowledged) acceptBoard(id, ...acknowledged);
                }
                const wasReady = readState.status === 'ready';
                readState = { status: 'ready', hasSnapshot: true };
                if (!wasReady) notify();
            } catch (error) {
                if (!shouldContinue()) return;
                const errorCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
                    ? error.code : 'board_record_unavailable';
                readState = { status: 'error', hasSnapshot: readState.hasSnapshot, errorCode };
                notify();
            }
        },
        /** View subscriptions stop on navigation; already-admitted writes remain owned by the Account lifetime. */
        retainView(start: () => () => void, bodyDemand = 'all') {
            if (!shouldContinue()) return () => {};
            demand.set(bodyDemand, (demand.get(bodyDemand) ?? 0) + 1);
            references++;
            if (references === 1) detach = start();
            return () => {
                const count = demand.get(bodyDemand) ?? 0;
                if (count <= 1) demand.delete(bodyDemand); else demand.set(bodyDemand, count - 1);
                if (references > 0) references--;
                if (references === 0) { detach?.(); detach = null; }
            };
        },
        retire() { detach?.(); detach = null; references = 0; demand.clear(); queue.reset(); },
    };
}
