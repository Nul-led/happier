import { SkillBundleEditorScreen } from '@/components/settings/prompts/skills/SkillBundleEditorScreen';

export function NewSkillBundlePage() {
  return <SkillBundleEditorScreen artifactId={null} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewSkillBundlePage as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewSkillBundlePage} />; }
