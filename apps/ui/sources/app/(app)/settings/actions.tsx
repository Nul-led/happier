import { ActionsSettingsView } from '@/components/settings/actions/ActionsSettingsView';

export const WorkspaceRouteBody = ActionsSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
