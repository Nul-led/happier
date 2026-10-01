import { VoiceConversationsSettingsScreen as WorkspaceRouteBody } from '@/voice/settings/screens/VoiceConversationsSettingsScreen';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
