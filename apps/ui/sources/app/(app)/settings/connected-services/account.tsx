import { ConnectedAccountServiceView } from '@/components/settings/connectedServices/account/ConnectedAccountServiceView';

export const WorkspaceRouteBody = ConnectedAccountServiceView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
