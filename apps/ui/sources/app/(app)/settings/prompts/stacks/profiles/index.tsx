import { PromptProfileStacksScreen } from '@/components/settings/prompts/stacks/PromptProfileStacksScreen';

export const WorkspaceRouteBody = PromptProfileStacksScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
