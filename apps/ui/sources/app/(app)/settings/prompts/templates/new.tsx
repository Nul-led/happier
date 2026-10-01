import { PromptTemplateEditorScreen } from '@/components/settings/prompts/templates/PromptTemplateEditorScreen';

export function NewPromptTemplateRoute() {
  return <PromptTemplateEditorScreen invocationId={null} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewPromptTemplateRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewPromptTemplateRoute} />; }
