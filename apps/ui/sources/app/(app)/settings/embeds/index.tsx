import { EmbedsSettingsIndex } from '@/components/settings/embeds/EmbedsSettingsIndex';

export const WorkspaceRouteBody = EmbedsSettingsIndex;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
