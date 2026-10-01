import { ActionSettingsDetailView } from '@/components/settings/actions/ActionSettingsDetailView';

export const WorkspaceRouteBody = ActionSettingsDetailView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
