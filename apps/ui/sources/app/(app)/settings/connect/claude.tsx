import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

export function ClaudeConnectRedirect() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace('/(app)/settings/connected-services/anthropic');
  }, [router]);

  return null;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ClaudeConnectRedirect as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ClaudeConnectRedirect} />; }
