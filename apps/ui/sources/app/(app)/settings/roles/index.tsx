import { RoleSettingsIndex } from '@/components/settings/roles/RoleSettingsIndex';

export const WorkspaceRouteBody = RoleSettingsIndex;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
