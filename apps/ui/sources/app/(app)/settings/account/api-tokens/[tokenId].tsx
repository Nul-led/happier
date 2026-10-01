import { ApiTokenDetailScreen } from '@/components/settings/apiTokens/ApiTokenDetailScreen';

export const WorkspaceRouteBody = ApiTokenDetailScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
