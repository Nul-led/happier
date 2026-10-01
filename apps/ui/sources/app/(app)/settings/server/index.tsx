import { HomesSettingsIndex as WorkspaceRouteBody } from '@/components/settings/server/collection/HomesSettingsIndex';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
