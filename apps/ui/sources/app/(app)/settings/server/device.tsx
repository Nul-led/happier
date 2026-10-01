import { HomesDeviceScreen as WorkspaceRouteBody } from '@/components/settings/server/collection/HomesDeviceScreen';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
