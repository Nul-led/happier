import { PushNotificationTroubleshootingView } from '@/components/settings/notifications/PushNotificationTroubleshootingView';

export const WorkspaceRouteBody = PushNotificationTroubleshootingView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
