import * as React from 'react';
import type { WorkBoardV1 } from '@happier-dev/protocol';

import { StatusPill } from '@/components/ui/status/StatusPill';
import { WORK_STATUS_PILL_VARIANT } from '@/components/work/status/resolveWorkStatusTone';
import { t } from '@/text';

import { countBoardCardsNeedingYou } from './model/boardCards';
import { useBoardLiveCards } from './model/useBoardContent';

/**
 * A pinned board's needs-you count in the Sessions column (lab `boards-B6`): the same membership and
 * cards as the open board, counted by the same owner as its header, as the column's own badge (the
 * plugin destinations' `StatusPill`). Mounted only for boards the person pinned; healthy boards show
 * nothing. The pinned rows share one Inbox model (`BoardsInboxBoundary` around the column's rows).
 */
export const PinnedBoardNeedsYouCount = React.memo(function PinnedBoardNeedsYouCount(props: Readonly<{ board: WorkBoardV1 }>) {
    const { cards } = useBoardLiveCards(props.board);
    const count = countBoardCardsNeedingYou(cards);
    if (count === 0) return null;
    return (
        <StatusPill
            testID={`pinned-board:${props.board.id}:need-you`}
            variant={WORK_STATUS_PILL_VARIANT.attention}
            label={String(count)}
            hideDot
            labelNumberOfLines={1}
            accessibilityLabel={t('boards.meta.needYou', { count })}
        />
    );
});
