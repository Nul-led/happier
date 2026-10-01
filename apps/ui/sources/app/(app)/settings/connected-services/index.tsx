import { ConnectedServicesSettingsView } from '@/components/settings/connectedServices/ConnectedServicesSettingsView';

export const WorkspaceRouteBody = ConnectedServicesSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
