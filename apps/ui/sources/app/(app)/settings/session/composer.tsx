import SessionComposerSettingsView from '@/components/settings/session/SessionComposerSettingsView';

export const WorkspaceRouteBody = SessionComposerSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
