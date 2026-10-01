import type { AppPaneScopeApi } from '@/components/appShell/panes/hooks/useAppPaneScope';
import * as React from 'react';
import { useDestinationParams, useDestinationRouter } from '@/components/appShell/workspace/DestinationInstanceHost';
import { readProjectRouteStringParam } from './projectRouteState';
import { createProjectCommitDetailsTab, createProjectFileDetailsTab } from './projectDetailsTabBuilders';

/** Destination-owned admission of the initial resource carried by its route. */
export function useProjectInitialResource(pane: AppPaneScopeApi): boolean {
    const params = useDestinationParams<{ initialFile?: string | string[]; initialCommit?: string | string[] }>();
    const router = useDestinationRouter();
    const file = readProjectRouteStringParam(params.initialFile);
    const commit = readProjectRouteStringParam(params.initialCommit);
    const lastAdmitted = React.useRef<string | null>(null);
    React.useEffect(() => {
        const tab = file ? createProjectFileDetailsTab(file) : commit ? createProjectCommitDetailsTab(commit) : null;
        if (!tab) {
            lastAdmitted.current = null;
            return;
        }
        const admissionKey = `${pane.scopeId}:${tab.key}`;
        if (lastAdmitted.current === admissionKey) return;
        lastAdmitted.current = admissionKey;
        pane.openDetailsTab(tab, { intent: 'pinned' });
        router.setParams({ initialFile: undefined, initialCommit: undefined });
    }, [commit, file, pane.openDetailsTab, pane.scopeId, router]);
    return Boolean(file || commit);
}
