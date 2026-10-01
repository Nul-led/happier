import SessionHandoffSettingsView from '@/components/settings/session/SessionHandoffSettingsView';

export const WorkspaceRouteBody = SessionHandoffSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
