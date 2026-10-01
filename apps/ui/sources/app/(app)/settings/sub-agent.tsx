import { SubAgentSettingsView } from '@/components/settings/subAgent/SubAgentSettingsView';

export const WorkspaceRouteBody = SubAgentSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
