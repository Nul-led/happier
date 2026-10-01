import { ApiTokensSettingsIndex } from '@/components/settings/apiTokens/collection/ApiTokensSettingsIndex';

export const WorkspaceRouteBody = ApiTokensSettingsIndex;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
