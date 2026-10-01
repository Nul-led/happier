import { NotificationsSettingsView } from '@/components/settings/notifications/NotificationsSettingsView';

export const WorkspaceRouteBody = NotificationsSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
