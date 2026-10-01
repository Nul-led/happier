import { applyWorkBoardIntentV1, DEFAULT_WORK_BOARDS_V1, WorkBoardsV1Schema, type WorkBoardIntentV1, type WorkBoardsV1 } from './workBoardV1.js';

export const WORK_BOARDS_ACCOUNT_KV_KEY_V1 = 'workspace:work-boards:v1';

export class WorkBoardMutationErrorV1 extends Error {
    constructor(readonly code: 'board_not_found' | 'invalid_board_record') {
        super(code);
        this.name = 'WorkBoardMutationErrorV1';
    }
}

export function readWorkBoardRecordV1(snapshot: WorkBoardRecordSnapshotV1): WorkBoardsV1 {
    if ((snapshot.value === null || snapshot.value === undefined) && (snapshot.version === -1 || snapshot.tombstone === true)) return DEFAULT_WORK_BOARDS_V1;
    const parsed = WorkBoardsV1Schema.safeParse(snapshot.value);
    if (!parsed.success) throw new WorkBoardMutationErrorV1('invalid_board_record');
    return parsed.data;
}

export type WorkBoardRecordSnapshotV1 = Readonly<{ value: unknown; version: number; tombstone?: true }>;
export type WorkBoardRecordTransportV1 = Readonly<{
    read(): Promise<WorkBoardRecordSnapshotV1>;
    compareAndSet(value: WorkBoardsV1, version: number): Promise<
        Readonly<{ success: true; version: number }> | (WorkBoardRecordSnapshotV1 & Readonly<{ success: false }>)
    >;
}>;

/** Every host shares this semantic owner; the host supplies only Account KV bytes, encryption and CAS. */
export type WorkBoardRecordPortV1 = Readonly<{
    read(signal?: AbortSignal): Promise<WorkBoardsV1>;
    apply(intent: WorkBoardIntentV1, signal?: AbortSignal): Promise<WorkBoardsV1>;
}>;

export function createWorkBoardRecordPortV1(
    transport: WorkBoardRecordTransportV1,
    options: Readonly<{ shouldContinue?: () => boolean; onRecord?: (boards: WorkBoardsV1, version: number) => void }> = {},
): WorkBoardRecordPortV1 {
    const check = (signal?: AbortSignal) => {
        signal?.throwIfAborted();
        if (options.shouldContinue && !options.shouldContinue()) {
            throw Object.assign(new Error('Board Account scope retired'), { code: 'account_kv_scope_retired' });
        }
    };
    return {
        async read(signal) {
            check(signal);
            const snapshot = await transport.read();
            check(signal);
            const boards = readWorkBoardRecordV1(snapshot);
            options.onRecord?.(boards, snapshot.version);
            return boards;
        },
        async apply(intent, signal) {
            check(signal);
            let snapshot = await transport.read();
            for (;;) {
                check(signal);
                const applied = applyWorkBoardIntentV1(readWorkBoardRecordV1(snapshot), intent);
                if (applied.status !== 'applied') throw new WorkBoardMutationErrorV1('board_not_found');
                check(signal);
                const result = await transport.compareAndSet(applied.boards, snapshot.version);
                check(signal);
                if (result.success) {
                    options.onRecord?.(applied.boards, result.version);
                    return applied.boards;
                }
                // Reapply semantic intent on the incumbent, preserving other devices' edits and opaque entries.
                snapshot = result;
            }
        },
    };
}
