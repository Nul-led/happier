// A machine's detail, hosted in the Machines collection. The screen is the machine detail page's own
// (`/machine/[id]`); only its place in navigation differs.
import { default as WorkspaceRouteBody } from '@/app/(app)/machine/[id]/index';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
