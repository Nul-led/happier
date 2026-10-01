import PermissionsSettingsView from '@/components/settings/session/PermissionsSettingsView';

export const WorkspaceRouteBody = PermissionsSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
