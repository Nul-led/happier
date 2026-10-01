import SessionResumeSettingsView from '@/components/settings/session/SessionResumeSettingsView';

export const WorkspaceRouteBody = SessionResumeSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
