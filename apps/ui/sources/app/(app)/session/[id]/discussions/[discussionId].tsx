import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
import { SessionDiscussionRouteScreen } from '@/components/sessions/conversations/SessionDiscussionRouteScreen';

export function SessionDiscussionRoute() {
    return <SessionDiscussionRouteScreen kind="discussion" />;
}

export { SessionDiscussionRoute as WorkspaceRouteBody };

export default function RouteEntry() { return <WorkspaceRouteEntry Body={SessionDiscussionRoute} />; }
