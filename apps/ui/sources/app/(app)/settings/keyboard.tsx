import { KeyboardShortcutsSettingsView } from '@/components/settings/keyboard/KeyboardShortcutsSettingsView';

export const WorkspaceRouteBody = KeyboardShortcutsSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
