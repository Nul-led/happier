import { RemoteHostsAccessPage as WorkspaceRouteBody } from '@/components/settings/remoteHosts/collection/RemoteHostsCollection';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
