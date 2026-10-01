import { qualifyPaneScopeId } from '@/components/appShell/panes/paneScopeIdentity';

export function buildProjectPaneScopeId(workspaceRefId: string, instanceKey?: string | null): string {
    const id = String(workspaceRefId ?? '').trim();
    return qualifyPaneScopeId(`project:${id || 'unknown'}`, instanceKey);
}
