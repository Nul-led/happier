import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { BoardScreen } from '@/components/boards/BoardScreen';
import { BoardsIndex } from '@/components/boards/BoardsIndex';

/** One board (INT §5.1). */
export function BoardRoute(): React.ReactElement {
    const params = useLocalSearchParams<{ boardId?: string | string[] }>();
    const boardId = Array.isArray(params.boardId) ? params.boardId[0] : params.boardId;
    if (!boardId) return <BoardsIndex />;
    return <BoardScreen boardId={boardId} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { BoardRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={BoardRoute} />; }
