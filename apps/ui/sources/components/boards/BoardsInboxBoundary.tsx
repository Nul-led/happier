import * as React from 'react';
import type { WorkBoardV1 } from '@happier-dev/protocol';

import { InboxModelBoundary } from '@/hooks/inbox/useInboxModel';

import { boardReadsNeedsYou } from './model/useBoardContent';

/**
 * One Inbox model for a list of boards' live lines (the pinned rows in the Sessions column, the Boards
 * column), mounted only while one of those boards shows Needs you. A board without that section never
 * reads the Inbox, so a list of such boards mounts none.
 */
export function BoardsInboxBoundary(props: Readonly<{ boards: readonly WorkBoardV1[]; children: React.ReactNode }>) {
    const needed = props.boards.some(boardReadsNeedsYou);
    return needed ? <InboxModelBoundary>{props.children}</InboxModelBoundary> : <>{props.children}</>;
}
