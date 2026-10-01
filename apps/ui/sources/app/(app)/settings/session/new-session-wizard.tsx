import NewSessionWizardSettingsView from '@/components/settings/session/NewSessionWizardSettingsView';

export const WorkspaceRouteBody = NewSessionWizardSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
