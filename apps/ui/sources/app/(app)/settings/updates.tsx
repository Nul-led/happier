import { UpdatesView } from '@/components/updates/UpdatesView';

export const WorkspaceRouteBody = UpdatesView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
