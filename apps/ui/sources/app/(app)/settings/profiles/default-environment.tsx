import { ProfileDefaultEnvironmentScreen } from '@/components/settings/profiles/ProfileDefaultEnvironmentScreen';

export const WorkspaceRouteBody = ProfileDefaultEnvironmentScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
