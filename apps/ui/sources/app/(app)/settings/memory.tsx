import { MemorySettingsView } from '@/components/settings/memory/MemorySettingsView';

export const WorkspaceRouteBody = MemorySettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
