import { useAiLaunchProfilesForLegacyUi } from '@/sync/store/useAiLaunchProfiles';
import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { PromptStacksScreen } from '@/components/settings/prompts/stacks/PromptStacksScreen';
import { PromptStackEditorScreen } from '@/components/settings/prompts/stacks/PromptStackEditorScreen';
import { useSetting } from '@/sync/domains/state/storage';

function firstParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}
export function PromptProfileStackEditorRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const profileId = firstParam(params.id);
  const rawProfiles = useSetting('profiles');
  const profiles = useAiLaunchProfilesForLegacyUi(rawProfiles);

  if (!profileId) return <PromptStacksScreen />;

  const profileName = profiles.find((p) => p.id === profileId)?.name ?? profileId;

  return <PromptStackEditorScreen surface="profile" profileId={profileId} title={profileName} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { PromptProfileStackEditorRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={PromptProfileStackEditorRoute} />; }
