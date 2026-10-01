import { AttachmentsSettingsView } from '@/components/settings/attachments/AttachmentsSettingsView';

export const WorkspaceRouteBody = AttachmentsSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
