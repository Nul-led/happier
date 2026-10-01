import { EmbedCreateScreen } from '@/components/settings/embeds/EmbedDetailScreen';

export const WorkspaceRouteBody = EmbedCreateScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
