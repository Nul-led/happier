import * as React from 'react';

import { PromptFoldersScreen } from '@/components/settings/prompts/folders/PromptFoldersScreen';

export function PromptFoldersRoute() {
  return <PromptFoldersScreen />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { PromptFoldersRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={PromptFoldersRoute} />; }
