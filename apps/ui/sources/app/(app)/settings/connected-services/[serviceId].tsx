import { ConnectedAccountLegacyRouteRedirect } from '@/components/settings/connectedServices/account/ConnectedAccountLegacyRouteRedirect';

export const WorkspaceRouteBody = ConnectedAccountLegacyRouteRedirect;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
