import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { PromptTemplateEditorScreen } from '@/components/settings/prompts/templates/PromptTemplateEditorScreen';

export function EditPromptTemplateRoute() {
  const params = useLocalSearchParams();
  const id = typeof params?.id === 'string' ? params.id : null;
  return <PromptTemplateEditorScreen invocationId={id} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { EditPromptTemplateRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={EditPromptTemplateRoute} />; }
