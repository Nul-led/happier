import { PromptDocEditorScreen } from '@/components/settings/prompts/docs/PromptDocEditorScreen';

export function NewPromptDocPage() {
  return <PromptDocEditorScreen artifactId={null} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewPromptDocPage as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewPromptDocPage} />; }
