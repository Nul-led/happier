import { PluginWebhookAdministrationScreen } from '@/components/settings/plugins/webhooks/PluginWebhookAdministrationScreen';

export const WorkspaceRouteBody = PluginWebhookAdministrationScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
