import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';
import { MachinePoolEditorRoute } from '@/components/settings/machines/pools/MachinePoolEditorScreen';

export function NewMachinePoolRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    return <MachinePoolEditorRoute params={params} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewMachinePoolRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewMachinePoolRoute} />; }
