import SessionProviderLimitsSettingsView from '@/components/settings/session/SessionProviderLimitsSettingsView';

export const WorkspaceRouteBody = SessionProviderLimitsSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
