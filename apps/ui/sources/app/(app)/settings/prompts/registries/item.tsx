import React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { PromptRegistryItemDetailsScreen } from '@/components/settings/prompts/registries/PromptRegistryItemDetailsScreen';
import { useSettingMutable } from '@/sync/domains/state/storage';

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export const WorkspaceRouteBody = React.memo(function PromptRegistryItemDetailsRoute() {
  const params = useLocalSearchParams<{
    sourceId?: string | string[];
    itemId?: string | string[];
    title?: string | string[];
    displayPath?: string | string[];
    workspacePath?: string | string[];
  }>();
  const [storedSources] = useSettingMutable('promptRegistrySourcesV1');

  return (
    <PromptRegistryItemDetailsScreen
      sourceId={readParam(params.sourceId)}
      itemId={readParam(params.itemId)}
      title={readParam(params.title)}
      displayPath={readParam(params.displayPath)}
      workspacePath={readParam(params.workspacePath)}
      configuredSources={storedSources.sources}
    />
  );
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
