import TranscriptSettingsView from '@/components/settings/session/TranscriptSettingsView';

export const WorkspaceRouteBody = TranscriptSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
