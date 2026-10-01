import {
    applyWorkBoardIntentV1,
    WorkBoardMutationErrorV1,
    type WorkBoardIntentV1,
    type WorkBoardsV1,
    type WorkBoardRecordPortV1,
} from '@happier-dev/protocol';

/**
 * The optimistic queue of a Home's dedicated Account KV Board record.
 *
 * Every edit is a `WorkBoardIntentV1` from the protocol owner. It shows at once — the displayed
 * boards are the last acknowledged boards with the pending intents replayed on top — and is then
 * written through the shared Board record port, which replays the same intent against the
 * current KV winner (so two devices editing different boards both land). A refusal drops the intent, so
 * the last acknowledged board shows again, and leaves an actionable failure with Retry.
 *
 * Writes run one at a time, in order: each replays against the result of the one before.
 */

export type WorkBoardSaveFailureReason = 'invalidValue' | 'not_found' | 'unavailable';

export type WorkBoardSaveFailure = Readonly<{
    intent: WorkBoardIntentV1;
    reason: WorkBoardSaveFailureReason;
}>;

export type WorkBoardSaveState = Readonly<{
    pending: readonly WorkBoardIntentV1[];
    failure: WorkBoardSaveFailure | null;
}>;

const INITIAL_STATE: WorkBoardSaveState = Object.freeze({ pending: Object.freeze([]), failure: null });

/** The boards to show: the acknowledged boards with every pending edit replayed by the protocol owner. */
export function projectDisplayedWorkBoards(acknowledged: WorkBoardsV1, pending: readonly WorkBoardIntentV1[]): WorkBoardsV1 {
    let boards = acknowledged;
    for (const intent of pending) {
        const result = applyWorkBoardIntentV1(boards, intent);
        if (result.status === 'applied') boards = result.boards;
    }
    return boards;
}

export type WorkBoardSaveQueue = Readonly<{
    getState(): WorkBoardSaveState;
    subscribe(listener: () => void): () => void;
    dispatch(intent: WorkBoardIntentV1): Promise<void>;
    /** Replays the failed edit. */
    retry(): Promise<void>;
    dismissFailure(): void;
    /** Forgets pending edits and the failure (another Account or Home took over). */
    reset(): void;
}>;

export function createWorkBoardSaveQueue(deps: Readonly<{ port: WorkBoardRecordPortV1 }>): WorkBoardSaveQueue {
    let state = INITIAL_STATE;
    let generation = 0;
    let tail: Promise<void> = Promise.resolve();
    const listeners = new Set<() => void>();
    const setState = (next: WorkBoardSaveState) => {
        state = next;
        for (const listener of listeners) listener();
    };

    const write = async (intent: WorkBoardIntentV1, writeGeneration: number): Promise<void> => {
        let failure: WorkBoardSaveFailure | null = null;
        try {
            if (writeGeneration !== generation) return;
            await deps.port.apply(intent);
        } catch (error) {
            failure = { intent, reason: error instanceof WorkBoardMutationErrorV1
                ? error.code === 'board_not_found' ? 'not_found' : 'invalidValue' : 'unavailable' };
        }
        if (writeGeneration !== generation) return;
        setState({
            pending: state.pending.filter((candidate) => candidate !== intent),
            failure: failure ?? state.failure,
        });
    };

    const dispatch = (intent: WorkBoardIntentV1): Promise<void> => {
        const writeGeneration = generation;
        setState({ pending: [...state.pending, intent], failure: null });
        tail = tail.then(() => write(intent, writeGeneration));
        return tail;
    };

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        dispatch,
        retry() {
            const failed = state.failure;
            return failed ? dispatch(failed.intent) : Promise.resolve();
        },
        dismissFailure() {
            if (state.failure) setState({ ...state, failure: null });
        },
        reset() {
            generation += 1;
            setState(INITIAL_STATE);
        },
    };
}
