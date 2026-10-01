import { MachineAddDraftScreen } from '@/components/machines/add/MachineAddDraftScreen';

export const WorkspaceRouteBody = MachineAddDraftScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
