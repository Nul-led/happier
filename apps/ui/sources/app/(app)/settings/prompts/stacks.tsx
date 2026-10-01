import { PromptStacksScreen } from '@/components/settings/prompts/stacks/PromptStacksScreen';

export const WorkspaceRouteBody = PromptStacksScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
