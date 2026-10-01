import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
import { SessionDiscussionRouteScreen } from '@/components/sessions/conversations/SessionDiscussionRouteScreen';

export function NewSessionDiscussionRoute() {
    return <SessionDiscussionRouteScreen kind="new" />;
}

export { NewSessionDiscussionRoute as WorkspaceRouteBody };

export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewSessionDiscussionRoute} />; }
