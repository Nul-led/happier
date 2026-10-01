import { BugReportComposerView } from '@/components/settings/bugReports/BugReportComposerView';

export const WorkspaceRouteBody = BugReportComposerView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
