import { DiagnosisView } from '@/components/settings/diagnosis/DiagnosisView';

export const WorkspaceRouteBody = DiagnosisView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
