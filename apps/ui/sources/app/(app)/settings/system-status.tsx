import { SystemStatusView } from '@/components/settings/systemStatus/SystemStatusView';

export const WorkspaceRouteBody = SystemStatusView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
