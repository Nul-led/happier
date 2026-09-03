import * as React from 'react';
import { useRouter } from 'expo-router';

import { useOptionalAppPaneContext } from '@/components/appShell/panes/AppPaneProvider';
import { useMobileWorkspaceExperienceState } from '@/components/workspaceCockpit/useMobileWorkspaceExperienceState';
import {
    useLocalSetting,
    useProjectLastMobileSurfacesByWorkspaceRefId,
    useSetting,
} from '@/sync/domains/state/storage';
import { useDeviceType } from '@/utils/platform/responsive';

import { buildProjectPaneScopeId } from './detail/projectPaneScope';
import { buildProjectRouteHref, resolveProjectOpenHref } from './detail/projectRouteState';
import { createProjectCommitDetailsTab, createProjectFileDetailsTab } from './detail/projectDetailsTabBuilders';

export type OpenProjectOptions = Readonly<{
    activeRootPath?: string;
    initialResource?: Readonly<{ kind: 'file'; path: string }> | Readonly<{ kind: 'commit'; sha: string }>;
}>;

/** Opens an existing project through the shared persisted surface/worktree policy. */
export function useOpenProject(): (workspaceRefId: string, options?: OpenProjectOptions) => boolean {
    const router = useRouter();
    const deviceType = useDeviceType();
    const paneContext = useOptionalAppPaneContext();
    const { cockpitEnabled } = useMobileWorkspaceExperienceState();
    const workspaceRefs = useSetting('workspaceRefsV1');
    const lastMobileSurfaceByWorkspaceRefId = useProjectLastMobileSurfacesByWorkspaceRefId();
    const lastActiveRootPathByWorkspaceRefId = useLocalSetting('projectLastActiveRootPathByWorkspaceRefId');
    const lastActiveWorktreeIdByWorkspaceRefId = useLocalSetting('projectLastActiveWorktreeIdByWorkspaceRefId');

    return React.useCallback((workspaceRefId: string, options?: OpenProjectOptions) => {
        const normalizedId = workspaceRefId.trim();
        const workspaceRef = (Array.isArray(workspaceRefs) ? workspaceRefs : [])
            .find((candidate) => candidate.id === normalizedId);
        if (!workspaceRef) return false;
        const scopeId = buildProjectPaneScopeId(workspaceRef.id);
        const activeRootPath = options?.activeRootPath?.trim()
            || lastActiveRootPathByWorkspaceRefId?.[workspaceRef.id]
            || workspaceRef.rootPath;
        const activeWorktreeId = activeRootPath === workspaceRef.rootPath
            ? null
            : activeRootPath === lastActiveRootPathByWorkspaceRefId?.[workspaceRef.id]
            ? lastActiveWorktreeIdByWorkspaceRefId?.[workspaceRef.id]
            : null;
        if (options?.initialResource) {
            const tab = options.initialResource.kind === 'file'
                ? createProjectFileDetailsTab(options.initialResource.path)
                : createProjectCommitDetailsTab(options.initialResource.sha);
            if (!tab || !paneContext) return false;
            paneContext.dispatch({ type: 'openDetailsTab', scopeId, tab, openAs: 'pinned' });
            router.push(buildProjectRouteHref({
                workspaceRefId: workspaceRef.id,
                ...(deviceType === 'phone' ? { segment: 'details' as const } : {}),
                activeRootPath,
                defaultRootPath: workspaceRef.rootPath,
                activeWorktreeId,
                ...(deviceType === 'phone'
                    ? { sourceSurface: options.initialResource.kind === 'file' ? 'browse' as const : 'git' as const }
                    : {}),
            }) as never);
            return true;
        }
        router.push(resolveProjectOpenHref({
            workspaceRef,
            deviceType,
            cockpitEnabled,
            rememberedRightTabId: paneContext?.state.scopes[scopeId]?.right?.activeTabId,
            persistedMobileSurface: lastMobileSurfaceByWorkspaceRefId[workspaceRef.id],
            persistedActiveRootPath: lastActiveRootPathByWorkspaceRefId?.[workspaceRef.id],
            persistedWorktreeId: lastActiveWorktreeIdByWorkspaceRefId?.[workspaceRef.id],
        }) as never);
        return true;
    }, [cockpitEnabled, deviceType, lastActiveRootPathByWorkspaceRefId, lastActiveWorktreeIdByWorkspaceRefId, lastMobileSurfaceByWorkspaceRefId, paneContext, router, workspaceRefs]);
}
