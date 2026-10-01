import { ThemeProfileImportScreen as WorkspaceRouteBody } from '@/components/settings/appearance/themeProfiles';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
