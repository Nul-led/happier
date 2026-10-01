export const WORK_BOARD_ACTION_IDS_V1 = [
    'boards.list', 'boards.apply',
] as const;

export type WorkBoardActionIdV1 = typeof WORK_BOARD_ACTION_IDS_V1[number];

export function isWorkBoardActionIdV1(value: string): value is WorkBoardActionIdV1 {
    return (WORK_BOARD_ACTION_IDS_V1 as readonly string[]).includes(value);
}
