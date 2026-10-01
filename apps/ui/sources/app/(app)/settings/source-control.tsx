import { SourceControlSettingsView } from '@/components/settings/sourceControl/SourceControlSettingsView';

export const WorkspaceRouteBody = SourceControlSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
