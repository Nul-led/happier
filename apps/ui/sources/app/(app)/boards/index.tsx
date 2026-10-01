import * as React from 'react';

import { BoardsIndex } from '@/components/boards/BoardsIndex';

/** The Boards destination with no board in the route (INT §5.1). */
export function BoardsRoute(): React.ReactElement {
    return <BoardsIndex />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { BoardsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={BoardsRoute} />; }
