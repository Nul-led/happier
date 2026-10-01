import { AccountSecuritySettingsScreen } from '@/components/settings/account/AccountSecuritySettingsScreen';

export const WorkspaceRouteBody = AccountSecuritySettingsScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
