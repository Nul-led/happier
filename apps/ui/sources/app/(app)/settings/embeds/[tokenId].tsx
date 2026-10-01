import { EmbedEditScreen } from '@/components/settings/embeds/EmbedDetailScreen';

export const WorkspaceRouteBody = EmbedEditScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
