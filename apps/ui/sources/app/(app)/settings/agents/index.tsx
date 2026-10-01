import { AgentSettingsIndex } from '@/components/settings/agents/AgentSettingsIndex';

export const WorkspaceRouteBody = AgentSettingsIndex;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
