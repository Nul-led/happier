import SessionRuntimeSettingsView from '@/components/settings/session/SessionRuntimeSettingsView';

export const WorkspaceRouteBody = SessionRuntimeSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
