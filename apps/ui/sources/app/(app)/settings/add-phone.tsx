import { AddPhoneSettingsView } from '@/components/settings/account/AddPhoneSettingsView';

export const WorkspaceRouteBody = AddPhoneSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
