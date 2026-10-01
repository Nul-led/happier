import * as React from 'react';

import { PromptStackEditorScreen } from '@/components/settings/prompts/stacks/PromptStackEditorScreen';
import { t } from '@/text';

export function VoicePromptStackRoute() {
  return <PromptStackEditorScreen surface="voice" title={t('promptLibrary.voiceStack')} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { VoicePromptStackRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={VoicePromptStackRoute} />; }
