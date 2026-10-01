import TranscriptRenderingAdvancedSettingsView from '@/components/settings/session/TranscriptRenderingAdvancedSettingsView';

export const WorkspaceRouteBody = TranscriptRenderingAdvancedSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
