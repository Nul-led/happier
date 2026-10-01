import { VoiceSettingsIntentIndexScreen as WorkspaceRouteBody } from '@/voice/settings/VoiceSettingsIntentIndexScreen';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
