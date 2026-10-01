import { ConnectedServicesProviderStateSharingSettingsView } from '@/components/settings/connectedServices/ConnectedServicesProviderStateSharingSettings';

export function ConnectedServicesProviderStateSharingRoute() {
    return <ConnectedServicesProviderStateSharingSettingsView />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ConnectedServicesProviderStateSharingRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ConnectedServicesProviderStateSharingRoute} />; }
