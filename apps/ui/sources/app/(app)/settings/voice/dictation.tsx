import { VoiceDictationSettingsScreen as WorkspaceRouteBody } from '@/voice/settings/screens/VoiceDictationSettingsScreen';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
