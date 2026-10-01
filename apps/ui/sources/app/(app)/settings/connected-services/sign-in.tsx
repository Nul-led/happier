import { ConnectedServicesAgentSignInView } from '@/components/settings/connectedServices/collection/ConnectedServicesAgentSignInView';

export const WorkspaceRouteBody = ConnectedServicesAgentSignInView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
