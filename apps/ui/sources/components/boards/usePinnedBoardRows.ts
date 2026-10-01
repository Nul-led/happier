import * as React from 'react';
import type { WorkBoardV1 } from '@happier-dev/protocol';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import type { ColumnLeadingRow } from '@/components/appShell/destinations/ColumnDestinationRows';

import { createBoardRoute } from './boardsRoutes';
import { PinnedBoardNeedsYouCount } from './PinnedBoardNeedsYouCount';
import { useWorkBoards } from './model/useWorkBoards';

const NO_PINNED: PinnedBoardRows = Object.freeze({ boards: Object.freeze([]), rows: Object.freeze([]) });

export type PinnedBoardRows = Readonly<{ boards: readonly WorkBoardV1[]; rows: readonly ColumnLeadingRow[] }>;

/**
 * Boards whose "Show in the Sessions list" is on (off by default), as rows at the top of the Sessions
 * column (lab `boards-B6`), each with its needs-you count from the board's own membership, and the
 * boards themselves so the column mounts one Inbox boundary for them. Selecting one opens it in Boards.
 */
export function usePinnedBoardRows(enabled: boolean): PinnedBoardRows {
    const router = useRouter();
    const boards = useWorkBoards().boards;
    return React.useMemo(() => {
        if (!enabled) return NO_PINNED;
        const pinned = boards.filter((board) => board.pinnedInSessions);
        if (pinned.length === 0) return NO_PINNED;
        return {
            boards: pinned,
            rows: pinned.map((board) => ({
                id: `board:${board.id}`,
                testID: `sessions-column:pinned-board:${board.id}`,
                title: board.name,
                icon: 'squares-four' as const,
                rightElement: React.createElement(PinnedBoardNeedsYouCount, { board }),
                selected: false,
                onPress: () => router.push(createBoardRoute(board.id) as never),
            })),
        };
    }, [boards, enabled, router]);
}
