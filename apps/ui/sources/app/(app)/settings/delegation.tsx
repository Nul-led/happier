import { DelegationSettingsView } from '@/components/settings/delegation/DelegationSettingsView';

export const WorkspaceRouteBody = DelegationSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
